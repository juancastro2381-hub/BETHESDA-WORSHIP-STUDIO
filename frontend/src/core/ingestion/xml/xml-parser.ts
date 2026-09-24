/**
 * @file xml-parser.ts
 * @description Parser de árbol XML ligero, robusto y seguro (protegido contra ataques XXE)
 * sin dependencias nativas ni de navegador, diseñado para procesar MusicXML 4.0.
 */

export class XmlElement {
  public readonly name: string;
  public readonly attributes: Readonly<Record<string, string>>;
  public readonly children: readonly XmlElement[];
  public readonly text: string;

  public constructor(
    name: string,
    attributes: Record<string, string> = {},
    children: XmlElement[] = [],
    text: string = ''
  ) {
    this.name = name;
    this.attributes = Object.freeze({ ...attributes });
    this.children = Object.freeze([...children]);
    this.text = text;
  }

  public child(name: string): XmlElement | undefined {
    return this.children.find((c) => c.name === name);
  }

  public childrenNamed(name: string): XmlElement[] {
    return this.children.filter((c) => c.name === name);
  }

  public attr(name: string): string | undefined {
    return this.attributes[name];
  }

  public childText(name: string): string | undefined {
    const el = this.child(name);
    return el ? el.text.trim() : undefined;
  }

  public childInt(name: string): number | undefined {
    const txt = this.childText(name);
    if (txt === undefined) return undefined;
    const parsed = parseInt(txt, 10);
    return isNaN(parsed) ? undefined : parsed;
  }

  public childFloat(name: string): number | undefined {
    const txt = this.childText(name);
    if (txt === undefined) return undefined;
    const parsed = parseFloat(txt);
    return isNaN(parsed) ? undefined : parsed;
  }
}

export class XmlParser {
  /**
   * Parsea un string XML y retorna el elemento raíz estructurado.
   * Rechaza de forma segura entidades externas (XXE) y DOCTYPE maliciosos.
   */
  public static parse(xmlString: string): XmlElement {
    // 1. Detección y bloqueo estricto de ataques XXE
    if (/<!ENTITY/i.test(xmlString) || /SYSTEM\s+["']/i.test(xmlString)) {
      throw new Error(
        'Inyección XXE detectada: Bethesda Worship Studio prohíbe el uso de entidades externas en XML.'
      );
    }

    // 2. Limpiar comentarios XML, declaraciones de procesamiento y DOCTYPE
    let cleaned = xmlString
      .replace(/<!--[\s\S]*?-->/g, '') // Eliminar comentarios
      .replace(/<\?[\s\S]*?\?>/g, '') // Eliminar <?xml ... ?>
      .replace(/<!DOCTYPE[\s\S]*?>/gi, ''); // Eliminar DOCTYPE

    // 3. Tokenizador de etiquetas y texto
    const tagRegex = /<(\/?)([\w:-]+)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;

    interface TagState {
      isClosing: boolean;
      name: string;
      rawAttrs: string;
      isSelfClosing: boolean;
      text?: string;
    }

    const tokens: TagState[] = [];
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(cleaned)) !== null) {
      if (match[5] !== undefined) {
        // Texto libre
        const textVal = match[5].trim();
        if (textVal) {
          tokens.push({
            isClosing: false,
            name: '',
            rawAttrs: '',
            isSelfClosing: false,
            text: XmlParser.unescapeEntities(textVal),
          });
        }
      } else if (match[2]) {
        // Etiqueta
        const isClosing = match[1] === '/';
        const name = match[2];
        const rawAttrs = match[3] ?? '';
        const isSelfClosing = match[4] === '/';
        tokens.push({
          isClosing,
          name,
          rawAttrs,
          isSelfClosing,
        });
      }
    }

    // 4. Construcción del Árbol DOM mediante Pila (Stack)
    interface StackNode {
      name: string;
      attributes: Record<string, string>;
      children: XmlElement[];
      textParts: string[];
    }

    const stack: StackNode[] = [];
    let rootNode: XmlElement | null = null;

    for (const token of tokens) {
      if (token.text !== undefined) {
        if (stack.length > 0) {
          stack[stack.length - 1]?.textParts.push(token.text);
        }
        continue;
      }

      if (token.isClosing) {
        // Cerrar etiqueta
        if (stack.length === 0) {
          throw new Error(`Etiqueta de cierre sin apertura: </${token.name}>`);
        }
        const popped = stack.pop();
        if (!popped || popped.name !== token.name) {
          throw new Error(
            `Desajuste de etiquetas XML: se esperaba </${popped?.name}> pero se recibió </${token.name}>`
          );
        }

        const element = new XmlElement(
          popped.name,
          popped.attributes,
          popped.children,
          popped.textParts.join(' ')
        );

        if (stack.length > 0) {
          stack[stack.length - 1]?.children.push(element);
        } else {
          rootNode = element;
        }
      } else {
        // Abrir etiqueta
        const attributes = XmlParser.parseAttributes(token.rawAttrs);

        if (token.isSelfClosing) {
          const selfClosingEl = new XmlElement(token.name, attributes, [], '');
          if (stack.length > 0) {
            stack[stack.length - 1]?.children.push(selfClosingEl);
          } else {
            rootNode = selfClosingEl;
          }
        } else {
          stack.push({
            name: token.name,
            attributes,
            children: [],
            textParts: [],
          });
        }
      }
    }

    if (stack.length > 0) {
      const unclosed = stack.map((s) => s.name).join(', ');
      throw new Error(`Etiquetas XML no cerradas al final del documento: ${unclosed}`);
    }

    if (!rootNode) {
      throw new Error('Documento XML vacío o sin elemento raíz válido.');
    }

    return rootNode;
  }

  private static parseAttributes(raw: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    if (!raw.trim()) return attrs;

    const attrRegex = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let match: RegExpExecArray | null;

    while ((match = attrRegex.exec(raw)) !== null) {
      const key = match[1];
      const val = match[2] ?? match[3] ?? match[4] ?? '';
      if (key) {
        attrs[key] = XmlParser.unescapeEntities(val);
      }
    }

    return attrs;
  }

  private static unescapeEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
}
