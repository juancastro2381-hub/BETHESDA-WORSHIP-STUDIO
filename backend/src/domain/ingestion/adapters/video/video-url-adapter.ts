/**
 * @file video-url-adapter.ts
 * @description Adaptador universal para ingesta segura de URLs de video autorizadas con prevención estricta de SSRF (Fase 1B).
 *
 * Principios:
 * 1. Validación de esquemas permitidos (únicamente https: y http: en dominios autorizados).
 * 2. Prevención rigurosa de Server-Side Request Forgery (SSRF):
 *    - Bloqueo de localhost, 127.0.0.1, 0.0.0.0, [::1].
 *    - Bloqueo de rangos CIDR privados (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16).
 *    - Bloqueo de dominios de metadatos cloud (169.254.169.254).
 * 3. Whitelist de plataformas autorizadas (YouTube, Vimeo).
 * 4. Respeto estricto a términos de servicio, DRM y protecciones de plataforma (CERO scraping ilícito).
 * 5. Reporte transparente: registra la referencia del video y reporta RECOGNITION_UNAVAILABLE para transcripción.
 */

import crypto from 'node:crypto';
import {
  CanonicalMusicPayload,
  Timeline,
} from '../../../../../../frontend/src/core/canonical-model/index.ts';
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
  public readonly version = '1.0.0';

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

    // 2. CanonicalMusicPayload en modo multimedia / enlace externo
    const timeline = new Timeline({
      totalDurationTicks: 0,
      measureCount: 0,
    });

    const canonicalPayload = new CanonicalMusicPayload({
      title,
      timeline,
      measures: [],
      sections: [],
      instrumentTracks: [],
      metadata: {
        isVideoReference: true,
        sourceFormat: 'VIDEO_URL',
        videoUrl: validated.url.toString(),
        platform: validated.platform,
        videoId: validated.videoId,
        sourceHash,
      },
    });

    const statusMessage =
      'Referencia de video autorizada y registrada. La extracción de audio y transcripción automática requieren el archivo fuente directo para respetar los términos de servicio de la plataforma.';

    diagnostics.push({
      code: 'VIDEO_URL_REGISTERED',
      severity: 'INFO',
      message: statusMessage,
    });

    return {
      status: 'CONVERTED',
      sourceType: 'VIDEO_URL',
      sourceHash,
      title,
      artist: input.artist || null,
      defaultKey: 'C',
      defaultBpm: 120,
      timeSignature: '4/4',
      canonicalPayload: canonicalPayload.toJSON(),
      diagnostics,
      recognitionStatusMessage: statusMessage,
    };
  }
}
