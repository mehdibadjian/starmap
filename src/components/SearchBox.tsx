import { forwardRef, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SearchHit } from "@/lib/search";

interface Props {
  value: string;
  onChange: (v: string) => void;
  results: SearchHit[];
  onPick: (id: number) => void;
  /** Total matches behind the dropdown cap, so the list can say "+N more". */
  totalResults?: number;
  className?: string;
}

const SearchBox = forwardRef<HTMLInputElement, Props>(
  ({ value, onChange, results, onPick, totalResults, className }, ref) => {
    const [focused, setFocused] = useState(false);
    // null means "nothing highlighted yet" — Enter then accepts the query as-is
    // (the graph and list both filter live) instead of jumping to the top hit.
    const [active, setActive] = useState<number | null>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const open = focused && value.trim().length > 0 && results.length > 0;

    useEffect(() => {
      setActive(null);
    }, [value]);

    const pick = (id: number) => {
      onPick(id);
      setFocused(false);
      setActive(null);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setActive((prev) => {
          const count = results.length;
          if (prev === null) return delta > 0 ? 0 : count - 1;
          return (prev + delta + count) % count;
        });
      } else if (e.key === "Enter") {
        if (active !== null && results[active]) {
          e.preventDefault();
          pick(results[active].id);
        } else {
          setFocused(false);
        }
      } else if (e.key === "Escape") {
        // Consume it: the global Escape goes "back up a level", and while the
        // dropdown is open, going back means closing the dropdown only.
        e.stopPropagation();
        setFocused(false);
        setActive(null);
      }
    };

    // Keep the highlighted row in view when arrowing past the scroll edge.
    useEffect(() => {
      if (active === null || !listRef.current) return;
      listRef.current.children[active]?.scrollIntoView({ block: "nearest" });
    }, [active]);

    const more = totalResults !== undefined ? totalResults - results.length : 0;

    // The input is 16px (text-base) on a phone and 12px from `sm` up: iOS Safari
    // auto-zooms the page when a focused field's text is smaller than 16px.
    return (
      <div className={cn("relative w-full max-w-xs", className)}>
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-label="Search stars"
          aria-expanded={open}
          aria-controls="search-results"
          aria-autocomplete="list"
          aria-activedescendant={active !== null && open ? `search-result-${results[active]?.id}` : undefined}
          autoComplete="off"
          placeholder="Search stars…"
          className="h-9 pl-8 text-base sm:h-8 sm:pl-7 sm:text-xs"
        />
        {!value && (
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground sm:block">
            /
          </kbd>
        )}

        {open && (
          <div
            id="search-results"
            ref={listRef}
            role="listbox"
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg"
          >
            {results.map((r, i) => (
              <div
                key={r.id}
                id={`search-result-${r.id}`}
                role="option"
                aria-selected={i === active}
                // onMouseDown, not onClick: blur fires first on mouse and would
                // close the list before the click ever lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(r.id);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-xs",
                  i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent",
                )}
              >
                <span className="truncate font-mono text-foreground">{r.nwo}</span>
                {r.cat[0] && <span className="shrink-0 text-[10px] text-muted-foreground">{r.cat[0]}</span>}
              </div>
            ))}
            {more > 0 && (
              <div className="border-t border-border px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
                +{more.toLocaleString()} more
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);
SearchBox.displayName = "SearchBox";

export default SearchBox;
