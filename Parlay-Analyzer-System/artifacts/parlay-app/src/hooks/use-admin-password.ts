import { useState, useRef, useCallback, useEffect } from "react";

const STORAGE_KEY = "adminPassword";

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
      if (pendingRef.current) {
        pendingRef.current(pwd);
        pendingRef.current = null;
      } else {
        setPassword(pwd);
      }
    },
    [setPassword]
  );

  const onCancel = useCallback(() => {
    pendingRef.current = null;
    setOpen(false);
  }, []);

  return { password, open, setOpen, withPassword, onSubmit, onCancel };
}
