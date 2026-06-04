import { useState, useEffect } from 'react';
import { User } from '@phosphor-icons/react';
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar';
import { cn } from '../../lib/utils';
import { useT } from '../../hooks/use-locale';

interface AvatarDisplayProps {
  roleId: string;
  roleName: string;
  size?: number;
  className?: string;
}

/**
 * Generate deterministic color based on role name
 */
function getColorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 50%, 60%)`;
}

/**
 * Extract initials from role name (max 2 characters)
 */
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function AvatarDisplay({ roleId, roleName, size = 40, className }: AvatarDisplayProps) {
  const t = useT();
  const [avatarData, setAvatarData] = useState<{ avatar: ArrayBuffer; mimeType: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let currentPreviewUrl: string | null = null;

    async function loadAvatar() {
      try {
        setIsLoading(true);
        setError(null);

        const result = await window.capibara.getAvatar(roleId);
        if (cancelled) return;

        if (result.ok && result.data) {
          setAvatarData(result.data);
          const blob = new Blob([result.data.avatar], { type: result.data.mimeType });
          currentPreviewUrl = URL.createObjectURL(blob);
          if (!cancelled) {
            setPreviewUrl(currentPreviewUrl);
          }
        } else {
          setAvatarData(null);
          setPreviewUrl(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t.avatar.failedToLoad);
          setAvatarData(null);
          setPreviewUrl(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadAvatar();
    return () => {
      cancelled = true;
      if (currentPreviewUrl) {
        URL.revokeObjectURL(currentPreviewUrl);
      }
    };
  }, [roleId, t.avatar.failedToLoad]);

  const fallbackInitials = getInitials(roleName);
  const fallbackColor = getColorFromName(roleName);

  if (isLoading) {
    return (
      <Avatar
        style={{ width: size, height: size }}
        className={cn('bg-muted animate-pulse', className)}
      >
        <AvatarFallback className="bg-transparent" />
      </Avatar>
    );
  }

  if (error) {
    return (
      <Avatar
        style={{ width: size, height: size }}
        className={cn('bg-muted', className)}
      >
        <AvatarFallback>
          <User size={size * 0.5} weight="fill" className="text-muted-foreground/80" />
        </AvatarFallback>
      </Avatar>
    );
  }

  if (avatarData && previewUrl) {
    return (
      <Avatar
        style={{ width: size, height: size }}
        className={cn('bg-muted', className)}
      >
        <AvatarImage
          src={previewUrl}
          alt={t.avatar.avatarAlt.replace('{roleName}', roleName)}
          onLoad={() => {
            if (previewUrl) {
              URL.revokeObjectURL(previewUrl);
            }
          }}
        />
        <AvatarFallback className="bg-transparent">
          <User size={size * 0.5} weight="fill" className="text-muted-foreground/80" />
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <Avatar
      style={{ width: size, height: size }}
      className={cn('bg-muted', className)}
    >
      <AvatarFallback
        style={{ backgroundColor: fallbackColor, color: 'white' }}
        className="text-xs font-semibold"
      >
        {fallbackInitials}
      </AvatarFallback>
    </Avatar>
  );
}
