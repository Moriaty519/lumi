import type { ReactNode } from 'react';

export function SheetModal(props: {
  title: string;
  subtitle?: string;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  closeOnBackdrop?: boolean;
  hideCloseButton?: boolean;
  className?: string;
}) {
  const closeOnBackdrop = props.closeOnBackdrop !== false;
  const showCloseButton = !props.hideCloseButton;
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (closeOnBackdrop && props.onClose) props.onClose();
      }}
    >
      <div
        className={`modal ${props.wide ? 'modal-wide' : ''} ${props.className || ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
      >
        <div className="modal-header">
          <div className="modal-title-info">
            <div className="modal-title">{props.title}</div>
            {props.subtitle ? <div className="modal-subtitle">{props.subtitle}</div> : null}
          </div>
          {showCloseButton && props.onClose && (
            <button
              type="button"
              className="modal-close"
              aria-label="关闭"
              onClick={props.onClose}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer ? <div className="modal-footer">{props.footer}</div> : null}
      </div>
    </div>
  );
}
