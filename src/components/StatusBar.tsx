type Props = {
  ready: number;
  target: number;
  generating: boolean;
  offline: boolean;
  reviewMode: boolean;
  error?: string;
  onOpenSettings: () => void;
};

export function StatusBar({ ready, target, generating, offline, reviewMode, error, onOpenSettings }: Props) {
  let status = `Ready · ${ready}/${target}`;
  if (offline && reviewMode) status = "Offline · Review";
  else if (offline) status = `Offline · ${ready}/${target} ready`;
  else if (generating) status = `Generating · ${ready}/${target} ready`;
  else if (error && reviewMode) status = "Generation paused · Review";
  else if (error) status = `Generation paused · ${ready}/${target} ready`;

  return (
    <header className="status-bar">
      <div className="status-copy" role="status" aria-live="polite">
        <span className={`status-dot ${generating ? "is-generating" : ""}`} aria-hidden="true" />
        {status}
      </div>
      <button className="icon-button" type="button" aria-label="Open settings" onClick={onOpenSettings}>⚙</button>
    </header>
  );
}
