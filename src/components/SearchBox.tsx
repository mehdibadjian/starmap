import { forwardRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SearchHit } from "@/lib/search";

interface Props {
  value: string;
  onChange: (v: string) => void;
  results: SearchHit[];
  onPick: (id: number) => void;
  className?: string;
}

const SearchBox = forwardRef<HTMLInputElement, Props>(({ value, onChange, results, onPick, className }, ref) => {
  const [focused, setFocused] = useState(false);
  const open = focused && value.trim().length > 0 && results.length > 0;

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
        placeholder="Search stars…"
        className="h-8 pl-7 font-mono text-xs"
      />
      {!value && (
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
          /
        </kbd>
      )}

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg">
          {results.map((r) => (
            <div
              key={r.id}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(r.id);
              }}
              className="flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-xs hover:bg-accent"
            >
              <span className="truncate font-mono text-foreground">{r.nwo}</span>
              {r.cat[0] && <span className="shrink-0 text-[10px] text-muted-foreground">{r.cat[0]}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
SearchBox.displayName = "SearchBox";

export default SearchBox;
