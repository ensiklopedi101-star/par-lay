import { useState, useRef, useCallback, useEffect } from "react";

/**
 * Shared storage key. `parlay-hooks.ts` sends this value as `x-admin-password`
 * and clears it whenever the API answers 401, so a mistyped password can never
 * lock every admin action behind a 401 loop.
 */
export const ADMIN_PASSWORD_STORAGE_KEY = "adminPassword";

const STORAGE_KEY = ADMIN_PASSWORD_STORAGE_KEY;

/** Fired when a stored password is rejected so every hook drops it at once. */
export const ADMIN_PASSWORD_CLEARED_EVENT = "admin-password-cleared";

export function clearStoredAdminPassword(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
  try {
    window.dispatchEvent(new Event(ADMIN_PASSWORD_CLEARED_EVENT));
  } catch {
    // ignore environments without window events
  }
}

export function useAdminPassword() {
  const [password, setPasswordState] = useState<string>("");
  const [open, setOpen] = useState(false);
  const pendingRef = useRef<((pwd: string) => void) | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) ?? "";
      setPasswordState(stored);
    } catch {
      // ignore storage errors
    }
    /* A 401 from any admin request clears the stored password; drop the copy
       held in component state too so `withPassword` opens the dialog again. */
    const onCleared = () => setPasswordState("");
    window.addEventListener(ADMIN_PASSWORD_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(ADMIN_PASSWORD_CLEARED_EVENT, onCleared);
  }, []);

  const setPassword = useCallback((pwd: string) => {
    setPasswordState(pwd);
    try {
      if (pwd) localStorage.setItem(STORAGE_KEY, pwd);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
  }, []);

  const clearPassword = useCallback(() => {
    setPasswordState("");
    pendingRef.current = null;
    clearStoredAdminPassword();
  }, []);

  const withPassword = useCallback(
    (action: (pwd: string) => void) => {
      if (password) {
        action(password);
        return;
      }
      pendingRef.current = (pwd: string) => {
        setPassword(pwd);
        action(pwd);
      };
      setOpen(true);
    },
    [password, setPassword]
  );

  const onSubmit = useCallback(
    (pwd: string) => {
      setOpen(false);
      const trimmed = pwd.trim();
      if (!trimmed) return;
      if (pendingRef.current) {
        pendingRef.current(trimmed);
        pendingRef.current = null;
      } else {
        setPassword(trimmed);
      }
    },
    [setPassword]
  );

  const onCancel = useCallback(() => {
    pendingRef.current = null;
    setOpen(false);
  }, []);

  return { password, open, setOpen, withPassword, clearPassword, onSubmit, onCancel };
}
