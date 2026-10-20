// Packages menu: Recent / starred packages and the author's other packages.
// Recent: stored locally (lib/recent.ts). By author: maintainers of this
// package → their packages (background.ts).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, RefObject } from 'preact';
import * as R from '../lib/recent.ts';
import type { AuthorPackagesResult, RecentState } from '../types.ts';
import { send } from './data.ts';
import { cx, errorText, short } from './util.ts';
import { Ph } from './Panel.tsx';

type AuthorState = AuthorPackagesResult | { error: string } | null; // null = loading

interface Props {
  pkg: string;
  open: boolean;
  onClose(): void;
  /** Panel host: clicks outside it close the menu. */
  host: HTMLElement;
  /** The Packages button, focused again after Escape. */
  button: RefObject<HTMLButtonElement | null>;
  /** Collapsed bar at the bottom of the screen: the menu opens upward. */
  collapsed: boolean;
  recent: RecentState | null;
  onStar(name: string): void;
}

const pkgUrl = (name: string) => `https://www.npmjs.com/package/${name}`;

export function PackagesMenu({ pkg, open, onClose, host, button, collapsed, recent, onStar }: Props) {
  const [tab, setTab] = useState<'recent' | 'author'>('recent');
  const [author, setAuthor] = useState<AuthorState>(null);
  const [authorUser, setAuthorUser] = useState<string | null>(null);
  const requested = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  async function loadAuthor(user: string | null | undefined): Promise<void> {
    requested.current = true;
    setAuthor(null);
    setAuthorUser(user || null);
    try {
      const res = await send({ type: 'authorPackages', pkg, user: user || null });
      if (alive.current) setAuthor(res);
    } catch (err) {
      if (alive.current) setAuthor({ error: errorText(err) });
    }
  }
  const showTab = (t: typeof tab) => {
    setTab(t);
    if (t === 'author' && !requested.current) loadAuthor(authorUser);
  };

  // Close on a click outside the panel or Escape (capture: before the page sees them).
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!e.composedPath().includes(host)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onClose();
      button.current?.focus();
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, host, onClose, button]);

  const loaded = author && !('error' in author) ? author : null;
  const starred = (name: string) => !!recent?.starred.includes(name);

  return (
    <div
      hidden={!open}
      class={cx(
        'absolute z-2 rounded-lg border border-border bg-bg p-1.5 font-ui text-md leading-[1.4] text-fg shadow-panel',
        // Expanded panel: drop down over the panel content (always on screen).
        // Collapsed bar at the bottom of the screen: open upward.
        collapsed ? 'right-0 bottom-[calc(100%_+_6px)] w-full min-w-60' : 'top-9 right-2 left-2'
      )}
    >
      <div class="mb-1 flex gap-0.5 rounded-md bg-subtle p-0.5" role="tablist">
        <Tab selected={tab === 'recent'} onClick={() => showTab('recent')}>
          Recent
        </Tab>
        <Tab selected={tab === 'author'} onClick={() => showTab('author')} title="Other packages by this package's maintainer">
          {loaded?.user ? `By @${loaded.user}` : 'By author'}
        </Tab>
      </div>
      <div>
        {tab === 'recent' ? (
          <RecentList pkg={pkg} items={R.list(recent ?? {})} onStar={onStar} />
        ) : !author ? (
          <SkeletonList />
        ) : 'error' in author ? (
          <Empty error>Couldn't load: {author.error}</Empty>
        ) : !author.user ? (
          <Empty>No maintainers listed for this package</Empty>
        ) : (
          <>
            {author.maintainers.length > 1 && (
              <div class="flex flex-wrap gap-1 px-1 pt-0.5 pb-1.5">
                {author.maintainers.slice(0, 4).map((m) => (
                  <button
                    key={m}
                    type="button"
                    class={cx('rounded-2xl border px-2 py-px text-xs', m === author.user ? 'border-accent text-accent' : 'border-border text-muted')}
                    onClick={() => loadAuthor(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
            {author.packages.length ? (
              <ul class="max-h-[300px] overflow-y-auto overscroll-contain">
                {author.packages.map((p) => (
                  <Item key={p.name} name={p.name} current={p.name === pkg} starred={starred(p.name)} onStar={onStar}>
                    {p.weekly != null && (
                      <span class="mr-1 flex-none text-xs text-muted tabular-nums" title="weekly downloads (npm)">
                        {short(p.weekly)}/wk
                      </span>
                    )}
                  </Item>
                ))}
              </ul>
            ) : (
              <Empty>No other packages</Empty>
            )}
          </>
        )}
      </div>
      <div class="mt-1 border-t border-border px-1.5 pt-1.5 pb-0.5 text-xs text-muted">
        {tab === 'author' && loaded?.user ? (
          <>
            <a class="text-inherit hover:text-accent" href={`https://www.npmjs.com/~${loaded.user}`}>
              @{loaded.user} on npm
            </a>
            {` · ${loaded.total} package${loaded.total === 1 ? '' : 's'} · npm weekly`}
          </>
        ) : (
          '★ keeps a package on top of Recent'
        )}
      </div>
    </div>
  );
}

function Tab({ selected, onClick, title, children }: { selected: boolean; onClick(): void; title?: string; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      title={title}
      class={cx(
        'min-w-0 flex-1 truncate rounded-sm px-1.5 py-[3px] text-xs font-semibold hover:text-fg-strong',
        selected ? 'bg-raised text-accent shadow-tab' : 'text-muted'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function RecentList({ pkg, items, onStar }: { pkg: string; items: R.RecentItem[]; onStar(name: string): void }) {
  if (!items.length) return <Empty>Nothing yet</Empty>;
  return (
    <ul class="max-h-[300px] overflow-y-auto overscroll-contain">
      {items.map((i) => (
        <Item key={i.name} name={i.name} current={i.name === pkg} starred={i.starred} onStar={onStar} />
      ))}
    </ul>
  );
}

function Item({ name, current, starred, onStar, children }: {
  name: string;
  current: boolean;
  starred: boolean;
  onStar(name: string): void;
  children?: ComponentChildren;
}) {
  return (
    <li class="flex items-center gap-1 rounded-sm p-0.5 hover:bg-subtle">
      <button
        type="button"
        class={cx('h-6 w-6 flex-none rounded-sm text-[15px] leading-none hover:text-fg-strong', starred ? 'text-star' : 'text-muted')}
        aria-pressed={starred}
        title={starred ? 'Unstar' : 'Star: keep on top of Recent'}
        onClick={(e) => {
          e.preventDefault();
          onStar(name);
        }}
      >
        {starred ? '★' : '☆'}
      </button>
      <a
        class={cx('min-w-0 flex-1 truncate px-0.5 py-[3px] no-underline hover:text-accent hover:underline', current ? 'font-semibold text-fg-strong' : 'text-fg')}
        href={pkgUrl(name)}
        title={name}
      >
        {name}
      </a>
      {children}
      {current && <span class="mr-1 flex-none rounded-xl border border-border px-1.5 text-2xs text-muted">open</span>}
    </li>
  );
}

// Same shape as a real row (star slot, name, weekly), placeholder text as
// shimmer bars; not interactive.
function SkeletonList() {
  return (
    <ul class="max-h-[300px] overflow-y-auto" aria-busy="true">
      {['package-name-long', 'package-name', 'pkg-name-longer-one', 'pkg-name'].map((name) => (
        <li key={name} class="pointer-events-none flex items-center gap-1 rounded-sm p-0.5" aria-hidden="true">
          <span class="h-6 w-6 flex-none" />
          <span class="min-w-0 flex-1 truncate px-0.5 py-[3px]">
            <Ph>{name}</Ph>
          </span>
          <span class="mr-1 flex-none text-xs tabular-nums">
            <Ph>00K/wk</Ph>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Empty({ error, children }: { error?: boolean; children: ComponentChildren }) {
  return <div class={cx('p-1.5', error ? 'text-down' : 'text-muted')}>{children}</div>;
}
