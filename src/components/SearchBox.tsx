import { forwardRef } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
}

const SearchBox = forwardRef<HTMLInputElement, Props>(({ value, onChange }, ref) => (
  <input
    ref={ref}
    type="text"
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder="/ to search…"
    className="w-64 rounded border border-border bg-bg px-2 py-1 font-mono text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
  />
));
SearchBox.displayName = "SearchBox";

export default SearchBox;
