import React from 'react';
import { UiLanguage, uiText } from './language';

/** Localize the presentation tree while preserving keys, refs, handlers and values.
 * Each UI component applies this at its render boundary. RadioCommLog deliberately
 * does not: its bilingual messages, speech controls and ordering remain unchanged.
 */
export function localizeUi(node: React.ReactNode, language: UiLanguage): React.ReactNode {
  if (language === 'CN') return node;
  if (typeof node === 'string') return uiText(node, language);
  if (Array.isArray(node)) return node.map((child) => localizeUi(child, language));
  if (!React.isValidElement(node)) return node;
  const element = node as React.ReactElement<Record<string, any>>;
  if (element.props['data-ui-preserve']) return element;
  const translated: Record<string, any> = {};
  for (const attribute of ['title', 'aria-label', 'alt', 'placeholder', 'nodeValue']) {
    if (typeof element.props[attribute] === 'string') {
      translated[attribute] = uiText(element.props[attribute], language);
    }
  }
  // Preserve every non-display prop, especially input/option values and event handlers.
  if (!Object.prototype.hasOwnProperty.call(element.props, 'children')) {
    return React.cloneElement(element, translated);
  }
  const children = element.props.children;
  return React.cloneElement(element, translated,
    ...(Array.isArray(children) ? children : [children]).map((child) => localizeUi(child, language)));
}
