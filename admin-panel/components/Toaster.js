import { CheckCircle2, Info, XCircle, X } from 'lucide-react';
import useToast from '../store/toast';

const ICONS = { success: CheckCircle2, error: XCircle, info: Info };
const TONES = {
  success: 'border-[#56e5a9]/30 text-[#56e5a9]',
  error: 'border-[#ec1414]/40 text-[#ff8a8a]',
  info: 'border-figma-accent/30 text-figma-accent',
};

export default function Toaster() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind] || Info;
        return (
          <div key={t.id} className={`pointer-events-auto flex items-start gap-3 rounded-lg border bg-[#121926] px-4 py-3 shadow-xl ${TONES[t.kind]}`}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="flex-1 text-[14px] text-white">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} className="text-white/60 hover:text-white" aria-label="Dismiss"><X className="h-4 w-4" /></button>
          </div>
        );
      })}
    </div>
  );
}
