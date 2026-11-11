import React, { useMemo } from 'react';
import { renderMathToHtml, renderTextWithMathToHtml, hasMathContent } from '../utils/mathRenderer';

interface MathEquationProps {
  expression: string;
  displayMode?: boolean;
  className?: string;
}

/**
 * High-performance React component for rendering mathematical formulas with KaTeX.
 * Handles fractions, vectors, hats, matrices, Greek letters, and physics notation.
 */
export const MathEquation: React.FC<MathEquationProps> = ({
  expression,
  displayMode = false,
  className = '',
}) => {
  const html = useMemo(() => {
    return renderMathToHtml(expression, displayMode);
  }, [expression, displayMode]);

  return (
    <span
      className={`katex-math-wrapper ${displayMode ? 'block my-1.5 overflow-x-auto py-1' : 'inline-block align-middle'} ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

interface FormattedMathTextProps {
  text: string;
  className?: string;
}

/**
 * Renders paragraphs of text that may contain embedded LaTeX math ($...$ or \(...\)),
 * rendering math seamlessly inline with the surrounding typography.
 */
export const FormattedMathText: React.FC<FormattedMathTextProps> = ({ text, className = '' }) => {
  const containsMath = useMemo(() => hasMathContent(text), [text]);

  if (!containsMath) {
    return <span className={className}>{text}</span>;
  }

  const html = renderTextWithMathToHtml(text);
  return (
    <span
      className={`prose-math-content ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
