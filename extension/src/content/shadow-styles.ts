// Plain CSS (not Tailwind) injected directly into the closed ShadowRoot — isolates completely
// from the host page's cascade and never leaks the dashboard's styles into it either
// (docs/Phase8_BrowserExtension_Implementation_Plan.md §4's Shadow-DOM design-token bridge).
// Re-declares the same notebook-identity tokens as globals.css/popup's styles.css.
export const SHADOW_STYLES = `
:host {
  --background: #faf9f5;
  --foreground: #191b22;
  --card: #ffffff;
  --border: #e5e2d9;
  --primary: #2c4be0;
  --primary-foreground: #f7f8ff;
  --secondary: #f0eee6;
  --muted-foreground: #6b6f7b;
  --success: #227a5b;
  --success-foreground: #f2fbf7;
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }

.quick-inject-btn {
  position: fixed;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--foreground);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(25, 27, 34, 0.12);
  transition: transform 150ms ease, box-shadow 150ms ease;
}
.quick-inject-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(25, 27, 34, 0.16); }
.quick-inject-btn:active { transform: scale(0.98); }

.save-selection-btn {
  position: fixed;
  z-index: 2147483000;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--foreground);
  color: var(--background);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(25, 27, 34, 0.2);
}

.panel {
  position: fixed;
  z-index: 2147483000;
  width: 320px;
  border-radius: 16px;
  border: 1px solid var(--border);
  background: var(--card);
  box-shadow: 0 12px 32px rgba(25, 27, 34, 0.18);
  padding: 16px;
  font-size: 13px;
  color: var(--foreground);
}

.panel-title { font-weight: 600; margin-bottom: 8px; }
.panel-muted { color: var(--muted-foreground); font-size: 12px; }

.memory-row {
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  line-height: 1.4;
}
.memory-row:last-child { border-bottom: none; }

.btn-primary {
  border-radius: 999px;
  background: var(--primary);
  color: var(--primary-foreground);
  border: none;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.btn-outline {
  border-radius: 999px;
  background: transparent;
  color: var(--foreground);
  border: 1px solid var(--border);
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
}

.toast {
  position: fixed;
  z-index: 2147483000;
  padding: 10px 16px;
  border-radius: 12px;
  background: var(--success);
  color: var(--success-foreground);
  font-size: 13px;
  box-shadow: 0 8px 20px rgba(25, 27, 34, 0.16);
}
`;
