/**
 * @file video-url-adapter.ts
 * @description Adaptador universal para ingesta segura de URLs de video autorizadas con prevención estricta de SSRF (Fase 1B-R).
 *
 * Principios:
 * 1. Validación de esquemas permitidos (únicamente https: y http: en dominios autorizados).
 * 2. Prevención rigurosa de Server-Side Request Forgery (SSRF):
 *    - Bloqueo de localhost, 127.0.0.1, 0.0.0.0, [::1].
 *    - Bloqueo de rangos CIDR privados (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16).
 *    - Bloqueo de dominios de metadatos cloud (169.254.169.254).
 * 3. Whitelist estricta de plataformas autorizadas (YouTube, Vimeo).
 * 4. Respeto absoluto a términos de servicio y DRM: CERO scraping ilícito.
 * 5. CERO invención musical: no se genera una partitura canónica ficticia ni se asumen tonos o métricas por defecto.
 * 6. Reporte transparente: registra la referencia del video y reporta VIDEO_URL_REGISTERED.
 */

import crypto from 'node:crypto';
import { ValidationError } from '../../../errors.ts';
import type { AuthenticatedUser } from '../../../auth-types.ts';
import type {
  IIngestionAdapter,
  IngestionDiagnostic,
  IngestionInput,
  IngestionOutput,
} from '../../types.ts';

const ALLOWED_VIDEO_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'vimeo.com',
  'www.vimeo.com',
  'player.vimeo.com',
]);

export class VideoUrlIngestionAdapter implements IIngestionAdapter {
  public readonly sourceType = 'VIDEO_URL' as const;
  public readonly name = 'Bethesda Authorized Video URL Adapter';
  public readonly version = '1.1.0';

  public canHandle(input: IngestionInput): boolean {
    if (input.sourceType === 'VIDEO_URL') return true;
    if (input.videoUrl && typeof input.videoUrl === 'string') return true;
    return false;
  }

  /**
   * Valida exhaustivamente una URL de video contra ataques de SSRF y dominios no autorizados.
   */
  public static validateVideoUrl(urlStr: string): { url: URL; platform: string; videoId?: string } {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      throw new ValidationError(`La URL proporcionada no tiene un formato válido: "${urlStr}"`);
    }

    // 1. Protocolo permitido únicamente HTTP/HTTPS
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new ValidationError(`Protocolo no permitido: "${parsed.protocol}". Se requiere HTTPS.`);
    }

    const hostname = parsed.hostname.toLowerCase();

    // 2. Prevención de SSRF: Bloqueo de loopback, redes privadas y metadatos cloud
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) {
      throw new ValidationError(`Violación de seguridad (SSRF): Intento de acceso a recurso local bloqueado.`);
    }

    // Detección de rangos IPv4 privados
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const b1 = parseInt(ipv4Match[1], 10);
      const b2 = parseInt(ipv4Match[2], 10);
      if (
        b1 === 10 || // 10.0.0.0/8
        b1 === 127 || // 127.0.0.0/8
        (b1 === 172 && b2 >= 16 && b2 <= 31) || // 172.16.0.0/12
        (b1 === 192 && b2 === 168) || // 192.168.0.0/16
        (b1 === 169 && b2 === 254) // 169.254.0.0/16 Link-Local / Cloud Metadata
      ) {
        throw new ValidationError(`Violación de seguridad (SSRF): Intento de acceso a red privada o de enlace local bloqueado.`);
      }
    }

    // 3. Whitelist de plataformas autorizadas
    if (!ALLOWED_VIDEO_HOSTS.has(hostname)) {
      throw new ValidationError(
        `Plataforma de video no autorizada: "${hostname}". Plataformas permitidas: YouTube (youtube.com, youtu.be) y Vimeo (vimeo.com). Si cuenta con el archivo de video/audio, utilice la opción de subida directa.`
      );
    }

    // 4. Identificar plataforma y videoId
    let platform = 'VIDEO';
    let videoId: string | undefined;

    if (hostname.includes('youtube') || hostname === 'youtu.be') {
      platform = 'YOUTUBE';
      if (hostname === 'youtu.be') {
        videoId = parsed.pathname.slice(1).split('/')[0];
      } else {
        videoId = parsed.searchParams.get('v') || undefined;
      }
    } else if (hostname.includes('vimeo')) {
      platform = 'VIMEO';
      const parts = parsed.pathname.split('/').filter(Boolean);
      videoId = parts[parts.length - 1];
    }

    return {
      url: parsed,
      platform,
      videoId,
    };
  }

  public async ingest(input: IngestionInput, _user: AuthenticatedUser): Promise<IngestionOutput> {
    const rawUrl = input.videoUrl?.trim();
    if (!rawUrl) {
      throw new ValidationError('La URL de video es requerida para este adaptador.');
    }

    // 1. Validar URL y aplicar defensas SSRF
    const validated = VideoUrlIngestionAdapter.validateVideoUrl(rawUrl);
    const sourceHash = crypto.createHash('sha256').update(rawUrl).digest('hex');
    const diagnostics: IngestionDiagnostic[] = [];

    const title = input.title?.trim() || `Referencia de Video (${validated.platform})`;

    const statusMessage =
      'Referencia de video autorizada y registrada. No se genera partitura canónica ficticia; la transcripción musical requerirá carga directa del archivo de audio/video o anotación manual.';

    diagnostics.push({
      code: 'VIDEO_URL_REGISTERED',
      severity: 'INFO',
      message: statusMessage,
    });

    // En Fase 1B-R: CERO invención musical. No se crea una partitura vacía con C, 120, 4/4.
    return {
      status: 'REGISTERED',
      sourceType: 'VIDEO_URL',
      sourceHash,
      title,
      artist: input.artist || null,
      defaultKey: null,
      defaultBpm: null,
      timeSignature: null,
      canonicalPayload: null,
      diagnostics,
      recognitionStatusMessage: statusMessage,
    };
  }
}
