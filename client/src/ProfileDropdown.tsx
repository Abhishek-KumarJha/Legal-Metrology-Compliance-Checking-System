import { useEffect, useRef, useState } from "react";

type ProfileDropdownProps = {
  user: { name: string; role: string };
  onLogout: () => void;
};

export default function ProfileDropdown({
  user,
  onLogout,
}: ProfileDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", marginLeft: "12px" }}>
      <button
        className="avatar"
        style={{ cursor: "pointer", border: "none", padding: 0 }}
        onClick={() => setOpen(!open)}
        aria-label="Profile menu"
      >
        {user.name.slice(0, 2).toUpperCase()}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            background: "var(--panel-bg)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "4px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            zIndex: 200,
            minWidth: "160px",
          }}
        >
          <div
            style={{
              padding: "8px 12px 6px",
              borderBottom: "1px solid var(--border)",
              marginBottom: "4px",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: "13px" }}>{user.name}</div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              {user.role === "company" ? "Company account" : "Officer account"}
            </div>
          </div>
          <button
            className="text-button"
            style={{
              width: "100%",
              justifyContent: "flex-start",
              padding: "8px 12px",
            }}
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
