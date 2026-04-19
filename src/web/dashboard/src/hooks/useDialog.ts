import { useState, useCallback, createElement, type ReactElement } from 'react';
import { ConfirmDialog, InputDialog } from '../components/common/Dialog';

/**
 * Hook providing async confirm() and prompt() methods that render a custom
 * themed dialog via React Portal, replacing native window.prompt/confirm.
 * See audit UI-02.
 *
 * Usage:
 *   const { dialog, confirm, prompt } = useDialog();
 *   const note = await prompt({ message: 'Reason for discarding (optional):' });
 *   if (note !== null) await discard(id, note);
 *   return <>{dialog}{...}</>;
 *
 * IMPORTANT: the component MUST render `{dialog}` somewhere in its JSX tree,
 * otherwise the portal never mounts and the promise never resolves.
 */

type ConfirmOpts = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
};

type PromptOpts = {
  title?: string;
  message: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  multiline?: boolean;
};

type DialogState =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void };

export function useDialog(): {
  dialog: ReactElement | null;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
} {
  const [state, setState] = useState<DialogState | null>(null);

  const confirm = useCallback((opts: ConfirmOpts) => {
    return new Promise<boolean>((resolve) => {
      setState({
        kind: 'confirm',
        opts,
        resolve: (v) => { setState(null); resolve(v); },
      });
    });
  }, []);

  const prompt = useCallback((opts: PromptOpts) => {
    return new Promise<string | null>((resolve) => {
      setState({
        kind: 'prompt',
        opts,
        resolve: (v) => { setState(null); resolve(v); },
      });
    });
  }, []);

  let dialog: ReactElement | null = null;
  if (state?.kind === 'confirm') {
    dialog = createElement(ConfirmDialog, { ...state.opts, onResolve: state.resolve });
  } else if (state?.kind === 'prompt') {
    dialog = createElement(InputDialog, { ...state.opts, onResolve: state.resolve });
  }

  return { dialog, confirm, prompt };
}
