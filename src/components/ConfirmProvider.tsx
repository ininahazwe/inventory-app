import React, { createContext, useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export type ConfirmOptions = {
    title?: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    tone?: "warning" | "success" | "default";
};

const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<boolean>>(() => Promise.resolve(false));


// export function useConfirm() {
//     return useContext(ConfirmCtx);
// }

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
    const [opts, setOpts] = useState<ConfirmOptions | null>(null);
    const [resolver, setResolver] = useState<((ok: boolean) => void) | null>(null);


    const confirm = useCallback((o: ConfirmOptions) => {
        setOpts(o);
        return new Promise<boolean>((resolve) => setResolver(() => resolve));
    }, []);


    const close = useCallback((ok: boolean) => {
        if (resolver) resolver(ok);
        setResolver(null);
        setTimeout(() => setOpts(null), 0);
    }, [resolver]);


    return (
        <ConfirmCtx.Provider value={confirm}>
            {children}
            <AnimatePresence>
                {opts && (
                    <motion.div
                        key="confirm-backdrop"
                        className="fixed inset-0 z-50 flex items-center justify-center"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => close(false)} />
                        <motion.div
                            key="confirm-dialog"
                            initial={{ y: 36, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 16, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 240, damping: 20 }}
                            className="relative z-10 w-[92%] max-w-md rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900"
                            role="dialog"
                            aria-modal
                        >
                            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">{opts.title ?? "Confirmer l'action"}</h3>
                            {opts.message && <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{opts.message}</p>}
                            <div className="mt-5 flex justify-end gap-2">
                                <button
                                    onClick={() => close(false)}
                                    className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                                >
                                    {opts.cancelText ?? "Annuler"}
                                </button>
                                <button
                                    onClick={() => close(true)}
                                    className={
                                        "rounded-xl px-3 py-2 text-sm font-semibold text-white " +
                                        (opts.tone === "warning"
                                            ? "bg-amber-600 hover:bg-amber-700"
                                            : opts.tone === "success"
                                                ? "bg-emerald-600 hover:bg-emerald-700"
                                                : "bg-neutral-900 hover:bg-neutral-800")
                                    }
                                >
                                    {opts.confirmText ?? "Confirmer"}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </ConfirmCtx.Provider>
    );
}
