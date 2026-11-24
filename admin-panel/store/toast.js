import { create } from 'zustand';

let nextId = 1;
const useToast = create((set, get) => ({
  toasts: [],
  push(kind, message) {
    const id = nextId++;
    set({ toasts: [...get().toasts, { id, kind, message }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 4500);
  },
  dismiss(id) { set({ toasts: get().toasts.filter((t) => t.id !== id) }); },
}));

export const toast = {
  success: (m) => useToast.getState().push('success', m),
  error: (m) => useToast.getState().push('error', m),
  info: (m) => useToast.getState().push('info', m),
};

export default useToast;
