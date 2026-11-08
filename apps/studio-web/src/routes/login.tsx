import { useState, type JSX } from 'react';
import { Link, useNavigate } from 'react-router';

import { useAuth, type AuthUser } from '../auth/auth-context.js';
import { Button } from '../components/button.js';
import { StatusBadge } from '../components/badge.js';
import { useOptionalStudioSession } from '../session-context.js';

export interface LoginRouteProps {
  readonly fetchImpl?: typeof fetch | undefined;
}

interface QuickRoleProfile {
  readonly id: string;
  readonly buttonId: string;
  readonly badge: string;
  readonly title: string;
  readonly subtitle: string;
  readonly capabilities: readonly string[];
  readonly defaultRoute: string;
  readonly defaultRouteLabel: string;
  readonly user: AuthUser;
}

const QUICK_ROLE_PROFILES: readonly QuickRoleProfile[] = [
  {
    id: 'role-engineer',
    buttonId: 'quick-access-engineer',
    badge: 'Staff Engineer',
    title: 'McMurray Stern Applications Engineer',
    subtitle: 'Full CAD layout authoring, column-grid setup, AI placement chat & 23-rule screening.',
    capabilities: [
      'Start with Columns First (0b) or 36-bay benchmark layout',
      'Stamp structural columns, draw walls & calibrate floorplan underlays',
      'Run interactive AI Assistant placement & natural-language commands (Ctrl+K)',
      'Author 13-sheet ANSI D submittals and export AutoCAD .dxf packages',
    ],
    defaultRoute: '/plan',
    defaultRouteLabel: 'Enter Plan Studio as Engineer',
    user: {
      email: 'engineer@mcmurraystern.com',
      name: 'Applications Engineer (McMurray Stern)',
      role: 'staff_engineer',
      organizationId: 'org-mcmurray-stern',
    },
  },
  {
    id: 'role-client-user',
    buttonId: 'quick-access-client',
    badge: 'Client Project Sponsor',
    title: 'Warehouse Manager / Project Sponsor',
    subtitle: 'Define building dimensions, generate preliminary layouts & compare design options.',
    capabilities: [
      'Enter building length, width, clear height & target pallet positions in Step 01',
      'Compare High-Density, Balanced Selective & Fast-Pick options in Step 02',
      'Inspect 2D Plan & Elevation views with live aisle & capacity metrics',
      'Export/import Client Intake JSON handoff packages',
    ],
    defaultRoute: '/facility',
    defaultRouteLabel: 'Start at Facility Intake as Client',
    user: {
      email: 'sponsor@pacificdistribution.com',
      name: 'Warehouse Project Sponsor',
      role: 'client_user',
      organizationId: 'org-pacific-dist',
    },
  },
  {
    id: 'role-client-admin',
    buttonId: 'quick-access-client-admin',
    badge: 'Client Org Admin',
    title: 'Client Operations & Procurement Lead',
    subtitle: 'Review BOM quantities, budgetary pricing tiers, 13-sheet drawings & revision sign-off.',
    capabilities: [
      'Inspect deterministic Bill of Materials (uprights, beams, wire decks, anchors)',
      'Review Option A/B/C and custom saved Plan snapshots side by side',
      'Preview all 13 ANSI D engineering submittal sheets (G-001 through E-601)',
      'Verify revision history and commercial trace records',
    ],
    defaultRoute: '/options',
    defaultRouteLabel: 'Open Options & BOM as Client Admin',
    user: {
      email: 'ops-admin@pacificdistribution.com',
      name: 'Client Operations Director',
      role: 'client_admin',
      organizationId: 'org-pacific-dist',
    },
  },
  {
    id: 'role-staff-admin',
    buttonId: 'quick-access-staff-admin',
    badge: 'Staff Administrator',
    title: 'McMurray Stern Principal / System Admin',
    subtitle: 'Full workspace governance, client invitation issuance, P01 submittal lock & C01 trace.',
    capabilities: [
      'Issue client organization invitation tokens via header Invite Client modal',
      'Execute P01 immutable revision locks when blocking checks = 0',
      'Generate C01 8-tuple commercial trace records for NetSuite / CRM handoff',
      'Full access across all 6 workflow steps and administrative controls',
    ],
    defaultRoute: '/revisions',
    defaultRouteLabel: 'Enter Studio as Staff Admin',
    user: {
      email: 'admin@mcmurraystern.com',
      name: 'McMurray Stern Admin',
      role: 'staff_admin',
      organizationId: 'org-mcmurray-stern',
    },
  },
];

interface WorkflowStepGuide {
  readonly stepNum: string;
  readonly id: string;
  readonly title: string;
  readonly route: string;
  readonly badge: string;
  readonly summary: string;
  readonly highlights: readonly string[];
}

const WORKFLOW_GUIDE_STEPS: readonly WorkflowStepGuide[] = [
  {
    stepNum: '01',
    id: 'guide-step-facility',
    title: 'Facility & Quick Space Generator',
    route: '/facility',
    badge: 'Step 01 · Intake',
    summary:
      'Capture site address, seismic design category (SDC), clear height, sprinkler deflector elevation, and generate a complete multi-run layout from room dimensions.',
    highlights: [
      'Quick Space Layout Generator (length × width × clear height × target pallet positions)',
      'Interior column grid toggle (30 ft / 40 ft / 50 ft spacing)',
      'Provenance badges (INPUT vs DERIVED vs DEFAULT) on every building parameter',
    ],
  },
  {
    stepNum: '02',
    id: 'guide-step-options',
    title: 'Design Options & Snapshot Matrix',
    route: '/options',
    badge: 'Step 02 · Compare',
    summary:
      'Compare Option A (High-Density), Option B (Balanced 36-Bay Benchmark), Option C (Starter 2-Bay), plus any custom Plan snapshots saved during your session.',
    highlights: [
      'Side-by-side pallet position count, bay count, narrowest aisle & budgetary range',
      'Save custom Plan layouts as Option D, E, F… and restore in one click',
      'Direct handoff into Step 03 Layout for detailed CAD refinement',
    ],
  },
  {
    stepNum: '03',
    id: 'guide-step-plan',
    title: 'Interactive Blueprint Plan, Elevation & Checks',
    route: '/plan',
    badge: 'Step 03 · Core CAD & AI',
    summary:
      'Author rack runs, structural columns, perimeter walls, and floorplan underlays with live micrometer-exact geometry, elevation profiles, and 23-rule screening.',
    highlights: [
      'Columns First (0b) starter mode + individual column stamp, nudge & delete toolbar',
      'Floorplan PNG/JPG/SVG underlay with opacity slider & 2-Point Scale Calibration',
      'Bottom-center dock: AI Placement Assistant, Commands (Ctrl+K), Spec Sheet Reader & JSON Handoff',
    ],
  },
  {
    stepNum: '04',
    id: 'guide-step-bom',
    title: 'Bill of Materials & Commercial Takeoff',
    route: '/bom',
    badge: 'Step 04 · Takeoff',
    summary:
      'Deterministic part-number takeoff derived directly from active rack runs, bay types, beam levels, back-to-back row spacers, and anchor bolts.',
    highlights: [
      'Live breakdown of upright frames, step beams, wire mesh decks, row spacers & anchors',
      'Exportable CSV takeoff table for vendor quoting and procurement review',
      'Updates automatically whenever bays, levels, or runs change in Plan view',
    ],
  },
  {
    stepNum: '05',
    id: 'guide-step-sheets',
    title: '13-Sheet ANSI D Submittal Set & DXF',
    route: '/sheets',
    badge: 'Step 05 · Drawings',
    summary:
      'Preview and export the complete 13-sheet engineering submittal package (G-001 Cover through E-601 Details) with provenance watermarks and AutoCAD .dxf output.',
    highlights: [
      'Interactive sheet selector across all 13 standard McMurray Stern submittal sheets',
      'Download Vector SVG, standalone HTML Sheet Set, or AutoCAD .dxf (AC1015)',
      'Automatic Preliminary Not-For-Construction watermark until P01 lock is completed',
    ],
  },
  {
    stepNum: '06',
    id: 'guide-step-revisions',
    title: 'Review, P01 Submittal Lock & C01 Trace',
    route: '/revisions',
    badge: 'Step 06 · Governance',
    summary:
      'Verify zero blocking screening checks, lock an immutable revision snapshot (P01), and emit the 8-tuple commercial trace record (C01).',
    highlights: [
      'Enforces hard gate: blocking screening findings must be 0 before locking',
      'Cryptographic SHA-256 revision digest and immutable timestamp ledger',
      'One-click C01 commercial trace payload for downstream ERP/CRM integration',
    ],
  },
];

export default function LoginRoute({ fetchImpl }: LoginRouteProps): JSX.Element {
  const { signIn, isAuthenticated, user, setUser } = useAuth();
  const studioSession = useOptionalStudioSession();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await signIn(
        {
          email: email.trim().toLowerCase(),
          password,
          mfaCode: mfaCode.trim(),
        },
        fetchImpl,
      );

      if (res.ok) {
        navigate('/plan', { replace: true });
      } else {
        setError(
          res.message ?? 'Invalid credentials. Please check your email, password, and MFA code.',
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickRoleAccess = (profile: QuickRoleProfile, targetRoute?: string): void => {
    setUser(profile.user);
    navigate(targetRoute ?? profile.defaultRoute);
  };

  const handleStartColumnsFirst = (): void => {
    if (!isAuthenticated) {
      setUser(QUICK_ROLE_PROFILES[0]!.user);
    }
    studioSession?.loadPreset('shell-columns');
    navigate('/plan');
  };

  const narrowestAisleIn =
    studioSession !== null && studioSession.plan.narrowestClearAisle !== null
      ? `${Math.round(studioSession.plan.narrowestClearAisle.value / 25_400)}"`
      : '—';

  return (
    <div className="main-portal-container" id="main-access-portal">
      {/* HERO & LIVE WORKSPACE STATUS BANNER */}
      <header className="portal-hero" id="portal-hero">
        <div className="portal-hero-top">
          <div>
            <div className="portal-eyebrow">
              MCMURRAY STERN · RACK MASTER STUDIO · USER ACCESS &amp; SYSTEM GUIDE
            </div>
            <h1 className="portal-hero-title">
              Warehouse Rack Layout, AI Placement &amp; Submittal Portal
            </h1>
            <p className="portal-hero-subtitle">
              Select a role profile below for instant studio access, sign in with your enterprise
              MFA credentials, or explore the 6-step engineering workflow and interactive Plan view
              capabilities.
            </p>
          </div>
          <div className="portal-hero-actions">
            <Button
              id="portal-launch-plan-btn"
              variant="primary"
              onClick={() => navigate('/plan')}
            >
              Open Plan Studio →
            </Button>
            <Button
              id="portal-launch-columns-first-btn"
              variant="ghost"
              onClick={handleStartColumnsFirst}
            >
              Start Columns First (0b)
            </Button>
            <Button
              id="portal-launch-facility-btn"
              variant="ghost"
              onClick={() => navigate('/facility')}
            >
              Quick Space Generator (Step 01)
            </Button>
          </div>
        </div>

        <div className="portal-kpi-row" aria-label="Active workspace summary">
          <div className="portal-kpi-cell">
            <span className="portal-kpi-label">Active Session Access</span>
            <span className="portal-kpi-val" id="portal-active-user-status">
              {isAuthenticated && user
                ? `${user.name ?? user.email} (${user.role ?? 'authenticated'})`
                : 'Open Sandbox Mode (Select a role below or sign in)'}
            </span>
          </div>
          {studioSession !== null && (
            <>
              <div className="portal-kpi-cell">
                <span className="portal-kpi-label">Loaded Project</span>
                <span className="portal-kpi-val">
                  {studioSession.session.document.name} · Rev{' '}
                  {studioSession.session.document.revision}
                </span>
              </div>
              <div className="portal-kpi-cell">
                <span className="portal-kpi-label">Capacity &amp; Geometry</span>
                <span className="portal-kpi-val">
                  {studioSession.plan.runs.length} Runs · {studioSession.plan.totalBays} Bays ·{' '}
                  {studioSession.plan.totalPositions} Positions
                </span>
              </div>
              <div className="portal-kpi-cell">
                <span className="portal-kpi-label">Narrowest Clear Aisle</span>
                <span className="portal-kpi-val">{narrowestAisleIn}</span>
              </div>
              <div className="portal-kpi-cell">
                <span className="portal-kpi-label">Screening Status</span>
                <span className="portal-kpi-val">
                  {studioSession.findingCounts.blocking === 0
                    ? `0 Blocking · ${studioSession.findingCounts.pass} Pass`
                    : `${studioSession.findingCounts.blocking} Blocking · ${studioSession.findingCounts.review} Review`}
                </span>
              </div>
            </>
          )}
        </div>
      </header>

      {/* SECTION 1: USER ACCESS & AUTHENTICATION */}
      <section className="portal-section" id="user-access-section" aria-label="User Access Portal">
        <div className="portal-section-head">
          <h2>1. User Access &amp; Role Selection</h2>
          <p>
            Choose an instant role-based workspace session to evaluate capabilities immediately, or
            authenticate with your organization email, password, and 6-digit TOTP code.
          </p>
        </div>

        <div className="portal-access-layout">
          {/* Left: One-Click Role Access Cards */}
          <div className="portal-role-grid" id="role-access-grid">
            {QUICK_ROLE_PROFILES.map((profile) => {
              const isCurrentRole = isAuthenticated && user?.email === profile.user.email;
              return (
                <article
                  key={profile.id}
                  id={profile.id}
                  className={isCurrentRole ? 'portal-card portal-card-active' : 'portal-card'}
                >
                  <div className="portal-card-head">
                    <StatusBadge tone={isCurrentRole ? 'pass' : 'info'}>
                      {isCurrentRole ? `${profile.badge} · Active` : profile.badge}
                    </StatusBadge>
                    <span className="portal-card-email">{profile.user.email}</span>
                  </div>
                  <h3 className="portal-card-title">{profile.title}</h3>
                  <p className="portal-card-desc">{profile.subtitle}</p>
                  <ul className="portal-feature-list">
                    {profile.capabilities.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <div className="portal-card-actions">
                    <button
                      id={profile.buttonId}
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleQuickRoleAccess(profile)}
                    >
                      {profile.defaultRouteLabel}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleQuickRoleAccess(profile, '/plan')}
                    >
                      Open Plan View
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Right: Standard MFA Sign-In Card + Invitation Redemption Card */}
          <div className="portal-auth-column">
            <section className="auth-card" id="login-card">
              <div className="auth-header">
                <h2 className="auth-title">Rack Master Studio Sign In</h2>
                <p className="auth-subtitle">
                  Enter your email, password, and authenticator app code to continue.
                </p>
              </div>

              {isAuthenticated ? (
                <div className="auth-form" id="already-signed-in">
                  <StatusBadge tone="pass">Signed In</StatusBadge>
                  <p>
                    You are currently signed in
                    {user ? ` as ${user.name ?? user.email} (${user.role ?? 'user'})` : ''}.
                  </p>
                  <div className="portal-card-actions">
                    <Button variant="primary" onClick={() => navigate('/plan')}>
                      Go to Plan View
                    </Button>
                    <Button variant="ghost" onClick={() => navigate('/facility')}>
                      Go to Step 01 Facility
                    </Button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="auth-form" id="login-form">
                  {error && (
                    <div id="login-error" role="alert" className="error-banner">
                      <StatusBadge tone="block">Sign In Failed</StatusBadge>
                      <span id="login-error-message">{error}</span>
                    </div>
                  )}

                  <div className="field-group">
                    <label htmlFor="login-email" className="field-label">
                      Email Address
                    </label>
                    <input
                      id="login-email"
                      name="email"
                      className="input-field"
                      type="email"
                      required
                      placeholder="user@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>

                  <div className="field-group">
                    <label htmlFor="login-password" className="field-label">
                      Password
                    </label>
                    <input
                      id="login-password"
                      name="password"
                      className="input-field"
                      type="password"
                      required
                      placeholder="••••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>

                  <div className="field-group">
                    <label htmlFor="login-mfa" className="field-label">
                      Second Factor (TOTP Code)
                    </label>
                    <input
                      id="login-mfa"
                      name="mfaCode"
                      className="input-field code-font"
                      type="text"
                      required
                      placeholder="6-digit authenticator code"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value)}
                    />
                    <span className="field-hint">
                      Generated by your configured authenticator application.
                    </span>
                  </div>

                  <Button
                    id="login-submit"
                    type="submit"
                    variant="primary"
                    isLoading={isSubmitting}
                    loadingText="Signing in…"
                  >
                    Sign In
                  </Button>
                </form>
              )}
            </section>

            <section className="portal-card" id="invite-access-card">
              <div className="portal-card-head">
                <StatusBadge tone="info">Client Onboarding</StatusBadge>
                <span className="portal-card-email">Token + TOTP Enrollment</span>
              </div>
              <h3 className="portal-card-title">Have a Client Invitation Token?</h3>
              <p className="portal-card-desc">
                New client users invited by a McMurray Stern engineer can redeem their single-use
                invitation link, set their password, and pair their authenticator app.
              </p>
              <div className="portal-card-actions">
                <Link id="portal-redeem-invite-link" to="/invite" className="btn btn-secondary">
                  Redeem Invitation Token →
                </Link>
              </div>
            </section>
          </div>
        </div>
      </section>

      {/* SECTION 2: 6-STEP ENGINEERING WORKFLOW DIRECTORY */}
      <section
        className="portal-section"
        id="workflow-guide-section"
        aria-label="6-Step Workflow Directory"
      >
        <div className="portal-section-head">
          <h2>2. Complete 6-Step Engineering Workflow Guide</h2>
          <p>
            Every job progresses from facility intake and option comparison through CAD layout,
            deterministic BOM takeoff, 13-sheet ANSI D submittals, and revision governance. Click
            any step to jump straight to that view.
          </p>
        </div>

        <div className="portal-workflow-grid" id="workflow-guide-grid">
          {WORKFLOW_GUIDE_STEPS.map((step) => (
            <article key={step.id} id={step.id} className="portal-card">
              <div className="portal-card-head">
                <StatusBadge tone="info">{step.badge}</StatusBadge>
                <span className="portal-step-num">STEP {step.stepNum}</span>
              </div>
              <h3 className="portal-card-title">{step.title}</h3>
              <p className="portal-card-desc">{step.summary}</p>
              <ul className="portal-feature-list">
                {step.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
              <div className="portal-card-actions">
                <Link to={step.route} className="btn btn-secondary">
                  Open Step {step.stepNum}: {step.title.split(' ')[0]} →
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* SECTION 3: PLAN VIEW TOOLS, AI PLACEMENT ASSISTANT & SHORTCUTS */}
      <section
        className="portal-section"
        id="capabilities-guide-section"
        aria-label="Plan View Capabilities and Keyboard Shortcuts"
      >
        <div className="portal-section-head">
          <h2>3. Plan View Capabilities, AI Placement Assistant &amp; Keyboard Shortcuts</h2>
          <p>
            Reference guide for the interactive 2D CAD Blueprint Plan view, pre-rack column layout,
            floorplan image calibration, and bottom-center command dock.
          </p>
        </div>

        <div className="portal-capabilities-grid">
          <article className="portal-card">
            <div className="portal-card-head">
              <StatusBadge tone="pass">Columns First (0b)</StatusBadge>
              <span className="portal-card-email">Pre-Rack Structural Grid</span>
            </div>
            <h3 className="portal-card-title">Start with Columns Before Placing Racks</h3>
            <p className="portal-card-desc">
              Click <b>0b Columns First</b> in the left parameters rail (or on this page) to clear
              racks and establish your building perimeter shell and structural column grid first.
            </p>
            <ul className="portal-feature-list">
              <li>
                <b>+ Stamp Column:</b> Click anywhere on the blueprint to place custom structural
                columns (e.g., <code>COL-1</code>, <code>COL-2</code>).
              </li>
              <li>
                <b>Column Selection Toolbar:</b> Click any stamped column on the canvas to nudge it{' '}
                <code>← ↑ ↓ →</code> by 6&quot; increments or delete it (<code>⌫</code>).
              </li>
              <li>
                <b>Auto-Route Racks Around Columns:</b> Ask the AI Assistant to{' '}
                <i>&quot;Place racks around columns&quot;</i> so aisles automatically straddle your
                column lines with zero bay collisions.
              </li>
            </ul>
          </article>

          <article className="portal-card">
            <div className="portal-card-head">
              <StatusBadge tone="info">Floorplan Underlay</StatusBadge>
              <span className="portal-card-email">CAD / PDF Raster Trace</span>
            </div>
            <h3 className="portal-card-title">Floorplan Image Upload &amp; 2-Pt Calibration</h3>
            <p className="portal-card-desc">
              Overlay an architectural floorplan image directly beneath the rack grid and calibrate
              real-world scale in seconds.
            </p>
            <ul className="portal-feature-list">
              <li>
                <b>Floorplan Image:</b> Click <code>Floorplan Image</code> in the canvas toolbar to
                load any PNG, JPG, or SVG drawing.
              </li>
              <li>
                <b>Opacity Slider:</b> Adjust underlay transparency from <code>10%</code> to{' '}
                <code>95%</code> for crisp contrast against rack runs.
              </li>
              <li>
                <b>2-Pt Scale Calibrate:</b> Click two points of known distance on your drawing,
                enter the real-world feet, and click <code>Apply Scale</code>.
              </li>
            </ul>
          </article>

          <article className="portal-card">
            <div className="portal-card-head">
              <StatusBadge tone="pass">Bottom-Center AI Dock</StatusBadge>
              <span className="portal-card-email">Interactive Assistant &amp; Commands</span>
            </div>
            <h3 className="portal-card-title">AI Placement Chat, Commands &amp; Spec Intake</h3>
            <p className="portal-card-desc">
              All command and AI workflows sit in the floating bottom-center dock on the Plan
              canvas—press <code>Esc</code> at any time to close an active tool or popover.
            </p>
            <ul className="portal-feature-list">
              <li>
                <b>AI Assistant:</b> Interactive chat with one-click prompt chips (
                <i>&quot;Start with columns first&quot;</i>,{' '}
                <i>&quot;Place racks around columns&quot;</i>,{' '}
                <i>&quot;Widen aisle 1 to 132 in&quot;</i>, <i>&quot;Fix failing checks&quot;</i>).
              </li>
              <li>
                <b>Commands (Ctrl+K):</b> Preview before/after capacity deltas for multi-step layout
                instructions before executing.
              </li>
              <li>
                <b>Read a Spec Sheet:</b> Upload a <code>.pdf</code>, <code>.txt</code>,{' '}
                <code>.csv</code>, or <code>.json</code> spec to stage and confirm building/pallet
                parameters with provenance.
              </li>
            </ul>
          </article>

          <article className="portal-card" id="shortcuts-reference-table">
            <div className="portal-card-head">
              <StatusBadge tone="info">Quick Reference</StatusBadge>
              <span className="portal-card-email">Keyboard &amp; Canvas Controls</span>
            </div>
            <h3 className="portal-card-title">Keyboard Shortcuts &amp; Canvas Hotkeys</h3>
            <div className="portal-shortcut-list">
              <div className="portal-shortcut-row">
                <kbd>Esc</kbd>
                <span>Exit active canvas tool (Measure, Wall, Column, Calibrate) &amp; close dock</span>
              </div>
              <div className="portal-shortcut-row">
                <kbd>Ctrl + K</kbd>
                <span>Toggle bottom-center Natural-Language Command Bar</span>
              </div>
              <div className="portal-shortcut-row">
                <kbd>Ctrl + Z</kbd>
                <span>Undo last layout, bay, or parameter command</span>
              </div>
              <div className="portal-shortcut-row">
                <kbd>F</kbd> / <kbd>+ −</kbd>
                <span>Fit drawing to viewport / Zoom in or out on canvas</span>
              </div>
              <div className="portal-shortcut-row">
                <kbd>I</kbd> / <kbd>S</kbd>
                <span>Insert bay after selected bay / Split run at selected bay</span>
              </div>
              <div className="portal-shortcut-row">
                <kbd>L</kbd> / <kbd>⌫ Del</kbd>
                <span>Lock or unlock selected bay / Delete selected bay or custom column</span>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
