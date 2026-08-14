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
  --primary-tint: #eef1fd;
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
  gap: 7px;
  padding: 9px 16px 9px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--foreground);
  font-size: 13px;
  font-weight: 500;
  cursor: grab;
  touch-action: none;
  box-shadow: 0 4px 16px rgba(25, 27, 34, 0.12);
  transition: box-shadow 150ms ease;
}
.quick-inject-btn:hover { box-shadow: 0 6px 20px rgba(25, 27, 34, 0.16); }
.quick-inject-btn:active { cursor: grabbing; }

.quick-inject-btn .badge-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--primary);
  color: var(--primary-foreground);
  font-size: 11px;
  flex-shrink: 0;
}

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
  animation: panel-in 140ms ease-out;
}

.panel-lg {
  width: 420px;
  padding: 18px;
}

@keyframes panel-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.panel-title { font-weight: 600; font-size: 15px; }
.panel-close {
  background: none;
  border: none;
  color: var(--muted-foreground);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  padding: 2px;
}
.panel-close:hover { color: var(--foreground); }
.panel-muted { color: var(--muted-foreground); font-size: 12px; }
.panel-stat {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--primary-tint);
  margin-bottom: 10px;
}
.panel-stat strong { color: var(--primary); }

.panel-select {
  width: 100%;
  margin-bottom: 12px;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--foreground);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}
.panel-select:focus { outline: 2px solid var(--primary); outline-offset: 1px; }

.inject-search {
  position: relative;
  margin-bottom: 10px;
}
.inject-search-icon {
  position: absolute;
  left: 11px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--muted-foreground);
  font-size: 14px;
  pointer-events: none;
}
.inject-search input {
  width: 100%;
  padding: 9px 10px 9px 30px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--foreground);
  font-size: 13px;
  font-family: inherit;
}
.inject-search input:focus { outline: 2px solid var(--primary); outline-offset: 1px; }
.inject-search input::placeholder { color: var(--muted-foreground); }

.link-btn {
  background: none;
  border: none;
  color: var(--primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}
.link-btn:hover { text-decoration: underline; }

.memory-row {
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  line-height: 1.4;
}
.memory-row:last-child { border-bottom: none; }

.memory-checklist {
  display: flex;
  flex-direction: column;
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  margin-bottom: 4px;
}
.memory-check-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 12px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 120ms ease;
}
.memory-check-row:last-child { border-bottom: none; }
.memory-check-row:hover { background: var(--secondary); }
.memory-check-row.is-checked { background: var(--primary-tint); }
.memory-check-row.is-checked:hover { background: var(--primary-tint); filter: brightness(0.97); }
.memory-check-row input[type="checkbox"] {
  margin-top: 2px;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  accent-color: var(--primary);
  cursor: pointer;
}
.memory-check-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--foreground);
}

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
