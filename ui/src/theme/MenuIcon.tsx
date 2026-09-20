export type MenuIconName =
    | "performance" | "transport" | "backingTracks" | "looper" | "recorder"
    | "drums" | "banks" | "edit" | "library" | "plugins" | "files"
    | "settings" | "about" | "reorder" | "drag" | "remove" | "overflow";

const paths: Record<MenuIconName, string[]> = {
    performance: ["M4 18V8m5 10V5m6 13V10m5 8V6", "M2 8h4M7 5h4m2 5h4m1-4h4"],
    transport: ["M12 4v16M5 12h14", "M7 7l-3 5 3 5m10-10 3 5-3 5"],
    backingTracks: ["M5 5h14v14H5z", "M9 8v8l7-4z"],
    looper: ["M7 7h9l-2-2m2 2-2 2", "M17 17H8l2 2m-2-2 2-2", "M18 9a6 6 0 010 6M6 15a6 6 0 010-6"],
    recorder: ["M7 4h10v16H7z", "M12 8v5", "M9.5 11.5a2.5 2.5 0 005 0", "M12 14v3m-3 0h6"],
    drums: ["M4 9h16v8c0 2-3.6 3-8 3s-8-1-8-3z", "M4 9c0 2 3.6 3 8 3s8-1 8-3-3.6-3-8-3-8 1-8 3z", "M7 5l2 4m8-4-2 4"],
    banks: ["M4 6h16v13H4z", "M4 10h16", "M8 3h8v3"],
    edit: ["M4 20l4.5-1 10-10-3.5-3.5-10 10z", "M13.5 6.5l3.5 3.5"],
    library: ["M5 4h11a3 3 0 013 3v13H8a3 3 0 00-3-3z", "M8 4v13a3 3 0 013 3"],
    plugins: ["M8 3v5H3v8h5v5h8v-5h5V8h-5V3z"],
    files: ["M3 6h7l2 2h9v11H3z"],
    settings: ["M12 8a4 4 0 100 8 4 4 0 000-8z", "M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"],
    about: ["M12 3a9 9 0 110 18 9 9 0 010-18z", "M12 10v6m0-9v.5"],
    reorder: ["M7 4v15M4 16l3 3 3-3", "M17 20V5m-3 3 3-3 3 3"],
    drag: ["M8 6h8M8 12h8M8 18h8"],
    remove: ["M6 6l12 12M18 6L6 18"],
    overflow: ["M5 12h.01M12 12h.01M19 12h.01"]
};

export function MenuIcon({ name, className = "" }: { name: MenuIconName; className?: string }) {
    return (
        <svg className={`mfx-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            {paths[name].map((path, index) => (
                <path key={index} d={path} fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" />
            ))}
        </svg>
    );
}
