import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { getToken, storeToken } from "../api/client";

interface TokenState {
  token: string;
  setToken: (token: string) => void;
}

const TokenContext = createContext<TokenState | null>(null);

export function TokenProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState(getToken);
  const setToken = useCallback(
    (next: string) => {
      storeToken(next);
      setTokenState(next);
      void queryClient.invalidateQueries();
    },
    [queryClient],
  );
  return <TokenContext.Provider value={{ token, setToken }}>{children}</TokenContext.Provider>;
}

export function useToken(): TokenState {
  const ctx = useContext(TokenContext);
  if (!ctx) throw new Error("useToken must be used inside TokenProvider");
  return ctx;
}
