import { viewByPath } from '../nav.js';

/**
 * What every S1 route renders: the view's name, what it will hold, and an
 * unambiguous statement that it holds none of it yet.
 *
 * S1's deliverable is the shell — "the header, banner, three-column frame, tabs
 * and theme toggle as routes, with nothing drawn yet". A placeholder that looked
 * like an empty plan would make "the app boots" readable as "the app works",
 * which is the reading `apps/api`'s UNIMPLEMENTED map exists to prevent for the
 * 22 routes that answer 500. Same discipline, same reason.
 */
export function ViewPlaceholder({ path }: { readonly path: string }): React.JSX.Element {
  const view = viewByPath(path);
  return (
    <section className="view-placeholder" aria-labelledby={`view-heading-${path}`}>
      <h1 id={`view-heading-${path}`}>{view?.label ?? path}</h1>
      <p className="lede">{view?.description}</p>
      <p className="not-implemented" data-state="not-implemented">
        <b>Not implemented.</b> This view is a routing target only. Nothing is derived, drawn or
        counted here yet.
      </p>
    </section>
  );
}
