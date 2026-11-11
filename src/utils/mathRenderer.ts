import katex from 'katex';

/**
 * Normalizes mathematical and physics expressions for robust KaTeX rendering.
 * Converts unicode math symbols, trims surrounding delimiters, and ensures safe fallbacks.
 */
export function sanitizeLatex(input: string): string {
  if (!input) return '';
  let text = input.trim();

  // Strip wrapping $$...$$ or $...$
  if (text.startsWith('$$') && text.endsWith('$$') && text.length >= 4) {
    text = text.slice(2, -2).trim();
  } else if (text.startsWith('$') && text.endsWith('$') && text.length >= 2) {
    text = text.slice(1, -1).trim();
  } else if (text.startsWith('\\[') && text.endsWith('\\]') && text.length >= 4) {
    text = text.slice(2, -2).trim();
  } else if (text.startsWith('\\(') && text.endsWith('\\)') && text.length >= 4) {
    text = text.slice(2, -2).trim();
  }

  // Replace common unicode math characters with KaTeX equivalents
  text = text
    .replace(/×/g, ' \\times ')
    .replace(/÷/g, ' \\div ')
    .replace(/±/g, ' \\pm ')
    .replace(/∓/g, ' \\mp ')
    .replace(/≈/g, ' \\approx ')
    .replace(/≠/g, ' \\neq ')
    .replace(/≤/g, ' \\le ')
    .replace(/≥/g, ' \\ge ')
    .replace(/≡/g, ' \\equiv ')
    .replace(/→/g, ' \\to ')
    .replace(/←/g, ' \\gets ')
    .replace(/↔/g, ' \\leftrightarrow ')
    .replace(/⇒/g, ' \\implies ')
    .replace(/⇔/g, ' \\iff ')
    .replace(/•/g, ' \\cdot ')
    .replace(/·/g, ' \\cdot ')
    .replace(/∇/g, ' \\nabla ')
    .replace(/∂/g, ' \\partial ')
    .replace(/∞/g, ' \\infty ')
    .replace(/α/g, ' \\alpha ')
    .replace(/β/g, ' \\beta ')
    .replace(/γ/g, ' \\gamma ')
    .replace(/δ/g, ' \\delta ')
    .replace(/Δ/g, ' \\Delta ')
    .replace(/ε/g, ' \\varepsilon ')
    .replace(/θ/g, ' \\theta ')
    .replace(/λ/g, ' \\lambda ')
    .replace(/μ/g, ' \\mu ')
    .replace(/π/g, ' \\pi ')
    .replace(/ρ/g, ' \\rho ')
    .replace(/σ/g, ' \\sigma ')
    .replace(/Σ/g, ' \\Sigma ')
    .replace(/τ/g, ' \\tau ')
    .replace(/φ/g, ' \\phi ')
    .replace(/Φ/g, ' \\Phi ')
    .replace(/ω/g, ' \\omega ')
    .replace(/Ω/g, ' \\Omega ');

  return text;
}

/**
 * Checks whether a string contains LaTeX commands, mathematical symbols, or formulas.
 */
export function hasMathContent(text: string): boolean {
  if (!text) return false;
  return (
    /\\(vec|hat|frac|sqrt|int|oint|sum|prod|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|rho|sigma|tau|phi|omega|times|div|pm|approx|neq|le|ge|cdot|partial|nabla|infty|mathbf|mathrm|text)/.test(
      text
    ) ||
    /[$^_{}\\]/.test(text) ||
    /[=<>±×÷≈≠≤≥→←↔]/.test(text)
  );
}

/**
 * Renders a math expression to an HTML string using KaTeX.
 * Returns safe fallback HTML if rendering encounters an error.
 */
export function renderMathToHtml(expression: string, displayMode: boolean = false): string {
  if (!expression || !expression.trim()) return '';
  const sanitized = sanitizeLatex(expression);

  try {
    return katex.renderToString(sanitized, {
      displayMode,
      throwOnError: false,
      output: 'html',
      strict: false,
      trust: false,
    });
  } catch (error) {
    console.warn('KaTeX render fallback for:', expression, error);
    // Graceful fallback: clean up raw slashes and return clean legible text
    const fallbackText = expression
      .replace(/\\vec\{([^}]+)\}/g, '$1')
      .replace(/\\hat\{([^}]+)\}/g, '$1^')
      .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
      .replace(/\\sqrt\{([^}]+)\}/g, 'sqrt($1)')
      .replace(/\\/g, '');
    return `<span class="font-mono text-slate-800">${escapeHtml(fallbackText)}</span>`;
  }
}

/**
 * Scans explanatory text for inline math like $...$ or \(...\) or raw formulas,
 * converting them into rendered KaTeX HTML while preserving regular prose.
 */
export function renderTextWithMathToHtml(text: string): string {
  if (!text) return '';

  // Look for inline math delimited by $...$ or \(...\)
  const regex = /(\$\$[\s\S]+?\$\$|\$[^\n$]+?\$|\\\[[\s\S]+?\\\]|\\\([^\n\\]+?\\\))/g;
  let lastIndex = 0;
  let result = '';
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const rawMatch = match[0];
    const plainText = text.substring(lastIndex, match.index);
    result += escapeHtml(plainText);

    const isDisplay = rawMatch.startsWith('$$') || rawMatch.startsWith('\\[');
    result += renderMathToHtml(rawMatch, isDisplay);
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    result += escapeHtml(text.substring(lastIndex));
  }

  return result;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
