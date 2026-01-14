import type { PageBody, Style, StyleQuery, CSSProperties } from '../types';

/**
 * Manager for handling CSS styles
 */
export class StyleManager {
  private body: PageBody;
  private styles: Style[];
  private compiledCSSOverride: string | null = null;

  constructor(body: PageBody) {
    this.body = body;
    this.styles = body.styles || [];
  }

  /**
   * Find styles by query
   */
  find(query: StyleQuery): Style[] {
    return this.styles.filter((style) => {
      let matches = true;

      // Check selector
      if (query.selector) {
        const hasSelector = style.selectors.some((sel) => {
          if (typeof sel === 'string') {
            return sel === query.selector || sel.includes(query.selector!);
          }
          return sel.name === query.selector;
        });
        
        if (!hasSelector && style.selectorsAdd !== query.selector) {
          matches = false;
        }
      }

      // Check media query
      if (query.mediaText && style.mediaText !== query.mediaText) {
        matches = false;
      }

      // Check state
      if (query.state && style.state !== query.state) {
        matches = false;
      }

      return matches;
    });
  }

  /**
   * Find styles for a specific selector
   */
  findBySelector(selector: string): Style[] {
    return this.find({ selector });
  }

  /**
   * Find styles for a media query
   */
  findByMedia(mediaText: string): Style[] {
    return this.find({ mediaText });
  }

  /**
   * Add a new style rule
   */
  addStyle(style: Style): void {
    this.compiledCSSOverride = null;
    this.styles.push(style);
  }

  /**
   * Remove styles by selector
   */
  removeBySelector(selector: string): number {
    this.compiledCSSOverride = null;
    const initialLength = this.styles.length;
    this.styles = this.styles.filter((style) => {
      const hasSelector = style.selectors.some((sel) => {
        if (typeof sel === 'string') {
          return sel === selector;
        }
        return sel.name === selector;
      });
      return !hasSelector && style.selectorsAdd !== selector;
    });
    return initialLength - this.styles.length;
  }

  /**
   * Update styles for a selector
   */
  updateStyle(selector: string, properties: CSSProperties, options?: { mediaText?: string; state?: string }): boolean {
    this.compiledCSSOverride = null;

    const matchingStyles = this.styles.filter((style) => {
      const hasSelector = style.selectors.some((sel) => {
        if (typeof sel === 'string') {
          return sel === selector;
        }
        return sel.name === selector;
      }) || style.selectorsAdd === selector;

      if (!hasSelector) return false;

      // Check media query if specified
      if (options?.mediaText && style.mediaText !== options.mediaText) {
        return false;
      }

      // Check state if specified
      if (options?.state && style.state !== options.state) {
        return false;
      }

      return true;
    });

    if (matchingStyles.length > 0) {
      matchingStyles.forEach((style) => {
        Object.assign(style.style, properties);
      });
      return true;
    }

    return false;
  }

  /**
   * Get style properties for a selector
   */
  getStyleProperties(selector: string, options?: { mediaText?: string; state?: string }): CSSProperties | null {
    const styles = this.find({ selector, ...options });
    if (styles.length > 0) {
      return styles[0]!.style;
    }
    return null;
  }

  /**
   * Get all styles
   */
  getAll(): Style[] {
    return this.styles;
  }

  /**
   * Get style count
   */
  count(): number {
    return this.styles.length;
  }

  /**
   * Override the compiled CSS string.
   * Useful when you want to edit raw CSS instead of structured Style[] rules.
   */
  setCompiledCSS(css: string): void {
    this.compiledCSSOverride = css;
    this.body.css = css;
  }

  /**
   * Clear any compiled CSS override (returns to Style[] -> CSS compilation).
   */
  clearCompiledCSSOverride(): void {
    this.compiledCSSOverride = null;
  }

  /**
   * Compile styles to CSS string
   */
  compileToCSS(): string {
    const cssRules: string[] = [];

    for (const style of this.styles) {
      const selector = this.buildSelector(style);
      const properties = this.buildProperties(style.style);
      const rule = `${selector}{${properties}}`;

      if (style.atRuleType === 'media' && style.mediaText) {
        cssRules.push(`@media ${style.mediaText}{${rule}}`);
      } else {
        cssRules.push(rule);
      }
    }

    return cssRules.join('');
  }

  /**
   * Build selector string from style
   */
  private buildSelector(style: Style): string {
    if (style.selectorsAdd) {
      let selector = style.selectorsAdd;
      if (style.state) {
        selector += `:${style.state}`;
      }
      return selector;
    }

    const selectors = style.selectors.map((sel) => {
      if (typeof sel === 'string') {
        return sel;
      }

      // EditorTs stores selector objects as component IDs by default.
      // Compile them as ID selectors unless the user provided a full selector.
      const name = sel.name.trim();
      const looksLikeSelector =
        name.startsWith('#') ||
        name.startsWith('.') ||
        name.startsWith('[') ||
        name.includes(' ') ||
        name.includes('>') ||
        name.includes('+') ||
        name.includes('~') ||
        name.includes(':');

      return looksLikeSelector ? name : `#${name}`;
    });

    let selector = selectors.join(', ');
    if (style.state) {
      selector = selectors.map((s) => `${s}:${style.state}`).join(', ');
    }

    return selector;
  }

  /**
   * Build CSS properties string
   */
  private buildProperties(properties: CSSProperties): string {
    return Object.entries(properties)
      .map(([key, value]) => `${key}:${value};`)
      .join('');
  }

  /**
   * Sync changes back to page body
   */
  sync(): void {
    this.body.styles = this.styles;
    this.body.css = this.compiledCSSOverride ?? this.compileToCSS();
  }

  /**
   * Replace all styles
   */
  replaceAll(styles: Style[]): void {
    this.compiledCSSOverride = null;
    this.styles = styles;
  }
}
