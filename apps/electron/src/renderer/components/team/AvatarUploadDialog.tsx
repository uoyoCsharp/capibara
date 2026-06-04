import { useState, useRef } from 'react';
import { Upload, X, CheckCircle, Warning } from '@phosphor-icons/react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { useT } from '../../hooks/use-locale';

interface AvatarUploadDialogProps {
  roleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadSuccess?: () => void;
}

const ALLOWED_FORMATS = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function validateFile(file: File, t: ReturnType<typeof useT>): { valid: boolean; error?: string } {
  if (!ALLOWED_FORMATS.includes(file.type)) {
    return {
      valid: false,
      error: t.avatar.invalidFormat,
    };
  }

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: t.avatar.fileTooLarge,
    };
  }

  return { valid: true };
}

type UploadStatus = 'idle' | 'validating' | 'uploading' | 'success' | 'error';

export function AvatarUploadDialog({ roleId, open, onOpenChange, onUploadSuccess }: AvatarUploadDialogProps) {
  const t = useT();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setStatus('idle');
    setErrorMessage(null);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState();
    }
    onOpenChange(newOpen);
  };

  const handleSelectFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus('validating');
    const validation = validateFile(file, t);

    if (!validation.valid) {
      setStatus('error');
      setErrorMessage(validation.error || t.avatar.uploadFailed);
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setStatus('idle');
    setErrorMessage(null);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      setStatus('uploading');
      setErrorMessage(null);

      const arrayBuffer = await selectedFile.arrayBuffer();
      const result = await window.capibara.uploadAvatar(roleId, arrayBuffer, selectedFile.type);

      if (result.ok) {
        setStatus('success');
        onUploadSuccess?.();

        setTimeout(() => {
          handleOpenChange(false);
        }, 1500);
      } else {
        setStatus('error');
        setErrorMessage(result.error?.message || t.avatar.uploadFailed);
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : t.avatar.uploadFailed);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t.avatar.uploadTitle}</DialogTitle>
          <DialogDescription>
            {t.avatar.uploadDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={handleFileChange}
          />

          {previewUrl ? (
            <div className="relative">
              <img
                src={previewUrl}
                alt={t.avatar.avatarPreview}
                className="w-32 h-32 rounded-full object-cover border-2 border-border"
              />
              <button
                type="button"
                onClick={() => {
                  setSelectedFile(null);
                  setPreviewUrl(null);
                  setStatus('idle');
                }}
                className="absolute -top-1 -right-1 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center hover:bg-destructive/90"
              >
                <X size={12} weight="bold" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSelectFile}
              className={cn(
                'w-32 h-32 rounded-full border-2 border-dashed border-border flex flex-col items-center justify-center gap-2',
                'hover:border-primary/50 hover:bg-accent/50 transition-colors',
                status === 'error' && 'border-destructive/50'
              )}
            >
              <Upload size={24} className="text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{t.avatar.selectImage}</span>
            </button>
          )}

          {errorMessage && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <Warning size={16} weight="fill" />
              {errorMessage}
            </div>
          )}

          {status === 'success' && (
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <CheckCircle size={16} />
              {t.avatar.uploadSuccess}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={status === 'uploading'}
          >
            {t.common.cancel}
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || status === 'uploading' || status === 'success'}
            className={status === 'uploading' ? 'animate-pulse' : ''}
          >
            {status === 'uploading' ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                {t.avatar.uploading}
              </span>
            ) : (
              t.avatar.uploadButton
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
