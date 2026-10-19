/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_BEAM_LEVELS,
  MIN_BEAM_LEVELS,
  PUBLISHED_BEAM_SPANS_IN,
} from './catalog-vocabulary.js';
import { DemoBeat5Widget } from './demo-beat-5.js';
import { OptionBuilder } from './option-builder.js';
import { OptionEditor } from './option-editor.js';
import { OptionsList } from './options-list.js';
import {
  OptionsApiError,
  fetchRevisionPreview,
  saveOptionsDraft,
} from './options-client.js';
import {
  OptionBuilderError,
  buildOptionRuns,
  createDefaultOption,
  createInitialOptions,
  duplicateOption,
  getOptionBlockingReasons,
  isOptionReady,
  offGridExplanation,
  selectBeamLevels,
  selectSpan,
  spanChoices,
  toOptionsApiPayload,
} from './options-model.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Demo Beat 5 — the single most important behaviour in the engine', () => {
  // "A client tries a 110-inch beam. The tool refuses, states that the
  //  published grid brackets it at 108 and 114, and explains that it does not
  //  interpolate."

  it('refuses 110 inches and names both brackets', () => {
    const result = selectSpan(PUBLISHED_BEAM_SPANS_IN, 110);

    expect(result.state).toBe('refused');
    if (result.state === 'refused') {
      expect(result.lowerIn).toBe(108);
      expect(result.upperIn).toBe(114);
    }
  });

  it('explains WHY, in words that teach the engine’s rule', () => {
    const result = selectSpan(PUBLISHED_BEAM_SPANS_IN, 110);
    if (result.state === 'refused') {
      expect(result.explanation).toMatch(/110"/);
      expect(result.explanation).toMatch(/108"/);
      expect(result.explanation).toMatch(/114"/);
      expect(result.explanation).toMatch(/does not interpolate/);
      // "Not available" would teach nothing and produce a support call.
      expect(result.explanation.length).toBeGreaterThan(80);
      expect(result.explanation).not.toMatch(/^Not available/);
    }
  });

  it('names the requested value in every off-grid explanation', () => {
    for (const requested of [24, 55, 110, 200]) {
      const result = selectSpan(PUBLISHED_BEAM_SPANS_IN, requested);
      if (result.state === 'refused') {
        expect(
          result.explanation,
          `explanation for ${requested}" must repeat the requested value`,
        ).toMatch(new RegExp(`\\b${requested}"`));
      }
    }
  });

  it('produces NO capacity and NO span, so nothing downstream can use one', () => {
    const result = selectSpan(PUBLISHED_BEAM_SPANS_IN, 110);
    expect(result).not.toHaveProperty('capacity');
    expect(result).not.toHaveProperty('spanIn');
  });

  it('does not nearest-match to 108, which is the tempting wrong answer', () => {
    const result = selectSpan(PUBLISHED_BEAM_SPANS_IN, 110);
    expect(result.state).not.toBe('selected');
  });

  it('accepts a published span (108″)', () => {
    const result = selectSpan(PUBLISHED_BEAM_SPANS_IN, 108);
    expect(result.state).toBe('selected');
    if (result.state === 'selected') {
      expect(result.spanIn).toBe(108);
    }
  });

  it('handles off-grid spans below the shortest and above the longest', () => {
    const tooShort = selectSpan(PUBLISHED_BEAM_SPANS_IN, 24);
    expect(tooShort.state).toBe('refused');
    if (tooShort.state === 'refused') {
      expect(tooShort.lowerIn).toBeNull();
      expect(tooShort.upperIn).toBe(48);
      expect(tooShort.explanation).toMatch(/shortest published span is 48"/);
    }

    const tooLong = selectSpan(PUBLISHED_BEAM_SPANS_IN, 250);
    expect(tooLong.state).toBe('refused');
    if (tooLong.state === 'refused') {
      expect(tooLong.lowerIn).toBe(168);
      expect(tooLong.upperIn).toBeNull();
      expect(tooLong.explanation).toMatch(/longest published span is 168"/);
    }
  });

  it('renders boundary fallback when both brackets are null', () => {
    const expl = offGridExplanation(100, null, null);
    expect(expl).toMatch(/100" is not a published beam span/);
    expect(expl).toMatch(/does not interpolate/);
  });
});

describe('Choices come ONLY from the pinned catalog', () => {
  it('offers exactly the published grid, in order', () => {
    const choices = spanChoices(PUBLISHED_BEAM_SPANS_IN);
    expect(choices.map((c) => c.spanIn)).toEqual([...PUBLISHED_BEAM_SPANS_IN].sort((a, b) => a - b));
  });

  it('throws an error if published spans list is empty', () => {
    expect(() => spanChoices([])).toThrow(OptionBuilderError);
  });

  it('throws an error if requested span is not finite', () => {
    expect(() => selectSpan(PUBLISHED_BEAM_SPANS_IN, NaN)).toThrow(OptionBuilderError);
    expect(() => selectSpan(PUBLISHED_BEAM_SPANS_IN, Infinity)).toThrow(OptionBuilderError);
  });
});

describe('Level configuration per OD-03 (floor plus 2-6 beam levels)', () => {
  it('accepts whole numbers in the 2..6 range', () => {
    for (let l = MIN_BEAM_LEVELS; l <= MAX_BEAM_LEVELS; l++) {
      const res = selectBeamLevels(l, true);
      expect(res.state).toBe('selected');
      if (res.state === 'selected') {
        expect(res.beamLevels).toBe(l);
        expect(res.floorStores).toBe(true);
      }
    }
  });

  it('refuses fractional numbers', () => {
    const res = selectBeamLevels(3.5, false);
    expect(res.state).toBe('refused');
    if (res.state === 'refused') {
      expect(res.explanation).toMatch(/whole number/);
    }
  });

  it('refuses out-of-range level counts', () => {
    const low = selectBeamLevels(1, true);
    expect(low.state).toBe('refused');
    if (low.state === 'refused') {
      expect(low.explanation).toMatch(/2 to 6 beam levels/);
    }

    const high = selectBeamLevels(7, true);
    expect(high.state).toBe('refused');
    if (high.state === 'refused') {
      expect(high.explanation).toMatch(/2 to 6 beam levels/);
    }
  });
});

describe('Multi-option lifecycle (FR-CP-04)', () => {
  it('creates valid default option', () => {
    const opt = createDefaultOption('opt-test', 'Test Option');
    expect(opt.id).toBe('opt-test');
    expect(opt.label).toBe('Test Option');
    expect(isOptionReady(opt)).toBe(true);
    expect(getOptionBlockingReasons(opt)).toHaveLength(0);
  });

  it('creates two initial options per Step 4 recommendation', () => {
    const initial = createInitialOptions();
    expect(initial).toHaveLength(2);
    expect(initial[0]!.id).toBe('opt-1');
    expect(initial[1]!.id).toBe('opt-2');
    expect(isOptionReady(initial[0]!)).toBe(true);
    expect(isOptionReady(initial[1]!)).toBe(true);
  });

  it('duplicates an existing option with a new id and label', () => {
    const original = createDefaultOption('opt-1', 'Base Option');
    const copy = duplicateOption(original, 'opt-copy', 'Base Option (Copy)');

    expect(copy.id).toBe('opt-copy');
    expect(copy.label).toBe('Base Option (Copy)');
    expect(copy.span).toEqual(original.span);
    expect(copy.frameDepthIn).toBe(original.frameDepthIn);
  });

  it('reports blocking reasons for invalid or empty options', () => {
    const broken = {
      ...createDefaultOption('opt-bad', ''),
      span: selectSpan(PUBLISHED_BEAM_SPANS_IN, 110), // Refused 110"
      aisleWidthIn: 0,
      runCount: 0,
      baysPerRun: 0,
    };

    expect(isOptionReady(broken)).toBe(false);
    const reasons = getOptionBlockingReasons(broken);
    expect(reasons.length).toBeGreaterThanOrEqual(4);
    expect(reasons.some((r) => r.includes('Option requires a non-empty name'))).toBe(true);
    expect(reasons.some((r) => r.includes('110" is not a published beam span'))).toBe(true);
    expect(reasons.some((r) => r.includes('positive measurement'))).toBe(true);
  });
});

describe('API Payload serialization & geometry', () => {
  it('buildOptionRuns computes micrometre runs and bays', () => {
    const opt = createDefaultOption('opt-geom', 'Geometry Test');
    const runs = buildOptionRuns(opt);

    expect(runs).toHaveLength(opt.runCount);
    expect(runs[0]!.bays).toHaveLength(opt.baysPerRun);
    expect(runs[0]!.bays[0]!.length_um).toBe(96 * 25_400);
    expect(runs[0]!.bays[0]!.levels).toBe(4);
  });

  it('toOptionsApiPayload serializes all options and resolves active option id', () => {
    const options = createInitialOptions();
    const payload = toOptionsApiPayload(options, 'opt-2');

    expect(payload.options).toHaveLength(2);
    expect(payload.active_option_id).toBe('opt-2');
    expect(payload.options[0]!.option_id).toBe('opt-1');
    expect(payload.options[1]!.option_id).toBe('opt-2');
  });

  it('toOptionsApiPayload throws if options array is empty', () => {
    expect(() => toOptionsApiPayload([])).toThrow(OptionBuilderError);
  });

  it('toOptionsApiPayload throws if any option has blocking reasons', () => {
    const broken = {
      ...createDefaultOption('bad-opt', 'Broken Option'),
      span: selectSpan(PUBLISHED_BEAM_SPANS_IN, 110),
    };
    expect(() => toOptionsApiPayload([broken])).toThrow(OptionBuilderError);
  });
});

describe('Options API client', () => {
  it('saveOptionsDraft sends POST request and returns result', async () => {
    const mockResult = {
      id: 'rev-1',
      code: 'REV-001',
      iteration: 2,
      frozen: false,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(mockResult),
    });

    const payload = toOptionsApiPayload(createInitialOptions());
    const res = await saveOptionsDraft('rev-1', payload, mockFetch as unknown as typeof fetch);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/client/v1/revisions/rev-1/options');
    expect(init.method).toBe('POST');
    expect(res).toEqual(mockResult);
  });

  it('saveOptionsDraft throws OptionsApiError on error responses', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: vi.fn().mockResolvedValue({
        error: { code: 'IMMUTABLE_REVISION', message: 'Revision is frozen' },
      }),
    });

    const payload = toOptionsApiPayload(createInitialOptions());
    await expect(saveOptionsDraft('rev-frozen', payload, mockFetch as unknown as typeof fetch)).rejects.toThrow(
      OptionsApiError,
    );
  });

  it('fetchRevisionPreview returns parsed JSON or null on 404', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ counts: { palletPositions: 320 } }),
    });

    const preview = await fetchRevisionPreview('rev-1', mockFetch as unknown as typeof fetch);
    expect(preview).toEqual({ counts: { palletPositions: 320 } });

    const notFoundFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });
    const nullPreview = await fetchRevisionPreview('rev-missing', notFoundFetch as unknown as typeof fetch);
    expect(nullPreview).toBeNull();
  });
});

describe('UI Component Integration', () => {
  describe('DemoBeat5Widget', () => {
    it('renders default 110″ refusal with both 108″ and 114″ brackets', () => {
      render(<DemoBeat5Widget />);

      expect(screen.getByTestId('demo-beat-5-card')).toBeDefined();
      expect(screen.getByTestId('off-grid-refusal')).toBeDefined();
      const explanation = screen.getByTestId('refusal-explanation');
      expect(explanation.textContent).toMatch(/110"/);
      expect(explanation.textContent).toMatch(/108"/);
      expect(explanation.textContent).toMatch(/114"/);
      expect(explanation.textContent).toMatch(/does not interpolate/);

      expect(screen.getByTestId('apply-lower-bracket-btn')).toBeDefined();
      expect(screen.getByTestId('apply-upper-bracket-btn')).toBeDefined();
    });

    it('changes to accepted when a published span is selected', () => {
      render(<DemoBeat5Widget />);

      const input = screen.getByTestId('demo-span-input');
      fireEvent.change(input, { target: { value: '108' } });

      expect(screen.queryByTestId('off-grid-refusal')).toBeNull();
      expect(screen.getByTestId('on-grid-accepted')).toBeDefined();
      expect(screen.getByTestId('on-grid-accepted').textContent).toMatch(/108″ is an approved published catalog span/);
    });

    it('calls onApplySpan when apply bracket button is clicked', () => {
      const onApply = vi.fn();
      render(<DemoBeat5Widget onApplySpan={onApply} />);

      const lowerBtn = screen.getByTestId('apply-lower-bracket-btn');
      fireEvent.click(lowerBtn);

      expect(onApply).toHaveBeenCalledWith(108);
    });
  });

  describe('OptionsList', () => {
    it('renders option tabs and handles add, duplicate, and delete', () => {
      const options = createInitialOptions();
      const onSelect = vi.fn();
      const onAdd = vi.fn();
      const onDuplicate = vi.fn();
      const onDelete = vi.fn();

      render(
        <OptionsList
          options={options}
          activeOptionId="opt-1"
          onSelectOption={onSelect}
          onAddOption={onAdd}
          onDuplicateOption={onDuplicate}
          onDeleteOption={onDelete}
        />,
      );

      expect(screen.getByTestId('option-tab-opt-1')).toBeDefined();
      expect(screen.getByTestId('option-tab-opt-2')).toBeDefined();

      fireEvent.click(screen.getByTestId('option-tab-opt-2'));
      expect(onSelect).toHaveBeenCalledWith('opt-2');

      fireEvent.click(screen.getByTestId('add-option-btn'));
      expect(onAdd).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId('duplicate-option-btn'));
      expect(onDuplicate).toHaveBeenCalledWith('opt-1');

      fireEvent.click(screen.getByTestId('delete-option-btn'));
      expect(onDelete).toHaveBeenCalledWith('opt-1');
    });
  });

  describe('OptionEditor', () => {
    it('updates fields when changed', () => {
      const option = createDefaultOption('opt-test', 'Test Option');
      const onChange = vi.fn();

      render(<OptionEditor option={option} onChange={onChange} />);

      const labelInput = screen.getByTestId('option-label-input');
      fireEvent.change(labelInput, { target: { value: 'Renamed Option' } });
      expect(onChange).toHaveBeenCalled();

      const spanSelect = screen.getByTestId('option-beam-span-select');
      fireEvent.change(spanSelect, { target: { value: '108' } });
      expect(onChange).toHaveBeenCalled();

      const levelsSelect = screen.getByTestId('option-beam-levels-select');
      fireEvent.change(levelsSelect, { target: { value: '5' } });
      expect(onChange).toHaveBeenCalled();
    });
  });

  describe('OptionBuilder', () => {
    it('renders end-to-end and saves options to revision', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ id: 'rev-123', code: 'REV-123', iteration: 1, frozen: false }),
      });

      render(
        <OptionBuilder
          revisionId="00000000-0000-0000-0000-000000000001"
          fetchImpl={mockFetch as unknown as typeof fetch}
        />,
      );

      expect(screen.getByTestId('option-builder')).toBeDefined();
      expect(screen.getByTestId('demo-beat-5-card')).toBeDefined();

      const saveBtn = screen.getByTestId('save-options-btn');
      expect(saveBtn).toBeDefined();

      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      expect(screen.getByTestId('save-status-alert')).toBeDefined();
      expect(screen.getByTestId('save-status-alert').textContent).toMatch(/Successfully saved 2 options/);
    });
  });
});
