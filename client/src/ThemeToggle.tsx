import { Moon, Sun } from "lucide-react";
import { useContext, useState } from "react";
import { ThemeContext, type Theme } from "./themeContext";

type ThemeToggleProps = {
  theme?: Theme;
  onToggle?: () => void;
  showLabel?: boolean;
};

export default function ThemeToggle({ theme, onToggle, showLabel = false }: ThemeToggleProps) {
  const context = useContext(ThemeContext);
  const [storedTheme, setStoredTheme] = useState<Theme>(
    () => localStorage.getItem("metro-check-theme") === "dark" ? "dark" : "light",
  );
  const activeTheme = theme ?? context?.theme ?? storedTheme;
  const fallbackToggle = () => {
    const next = activeTheme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("metro-check-theme", next);
    setStoredTheme(next);
  };
  const toggle = onToggle ?? context?.toggle ?? fallbackToggle;
  const nextTheme = activeTheme === "light" ? "dark" : "light";

  return <button className="theme-toggle" type="button" onClick={toggle} aria-label={`Switch to ${nextTheme} mode`} title={`Switch to ${nextTheme} mode`}>
    {activeTheme === "light" ? <Moon size={16} /> : <Sun size={16} />}
    {showLabel && <span>{activeTheme === "light" ? "Dark" : "Light"}</span>}
  </button>;
}
