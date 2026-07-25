import { forwardRef } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}

const SearchBox = forwardRef<HTMLInputElement, Props>(({ value, onChange, className }, ref) => (
  <div className={cn("relative w-full max-w-xs", className)}>
    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    <Input
      ref={ref}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search stars…"
      className="h-8 pl-7 font-mono text-xs"
    />
    {!value && (
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
        /
      </kbd>
    )}
  </div>
));
SearchBox.displayName = "SearchBox";

export default SearchBox;
