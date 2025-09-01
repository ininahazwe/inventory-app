// Autocomplete.tsx
import { useEffect, useMemo, useRef, useState } from "react";

export default function Autocomplete({
                                         value, onChange, fetchOptions, placeholder, className,
                                     }: {
    value: string;
    onChange: (v: string) => void;
    fetchOptions: (q: string) => Promise<string[]>;
    placeholder?: string;
    className?: string; // << nouveau
}) {
    const [q, setQ] = useState(value || "");
    const [opts, setOpts] = useState<string[]>([]);
    const [open, setOpen] = useState(false);
    const boxRef = useRef<HTMLDivElement>(null);

    const debounced = useMemo(() => {
        let t: any;
        return (val: string) => {
            clearTimeout(t);
            t = setTimeout(async () => setOpts(await fetchOptions(val)), 160);
        };
    }, [fetchOptions]);

    useEffect(() => { debounced(q); }, [q, debounced]);

    // fermer si clic dehors
    useEffect(() => {
        const onDoc = (e: MouseEvent) => {
            if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onDoc);
        return () => document.removeEventListener("mousedown", onDoc);
    }, []);

    return (
        <div className="autocomplete" ref={boxRef} style={{ position:"relative" }}>
            <input
                className={className || "field"}
                value={q}
                onChange={(e) => { setQ(e.target.value); onChange(e.target.value); }}
                onFocus={() => { if (opts.length) setOpen(true); }}
                placeholder={placeholder}
                autoComplete="off"
            />
            {open && opts.length > 0 && (
                <div className="auto-list">
                    {opts.map(o => (
                        <div
                            key={o}
                            className="auto-item"
                            onMouseDown={() => { onChange(o); setQ(o); setOpen(false); }}
                        >
                            {o}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
