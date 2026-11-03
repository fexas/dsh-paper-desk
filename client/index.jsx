import React from 'react';
import TYPERT_REMOTE from './contracts';
import { makeApi, isChineseLocale } from './api';
import { PaperDeskApp } from './App';
import styles from './styles.css';
import flowCss from '@xyflow/react/dist/style.css';
import katexCss from 'virtual:katex-css';

const PANEL_ID = 'paper-desk';

function PaperDeskIcon({ size = 18, active = false }) {
  const accent = active ? 'var(--dsw-alias-brand-primary, #4D6BFE)' : 'currentColor';
  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      'aria-hidden': true,
    },
    React.createElement('path', {
      d: 'M6.5 3.5h7.2L18.5 8v12.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinejoin: 'round',
    }),
    React.createElement('path', {
      d: 'M13.5 3.8V8.5h4.6',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinejoin: 'round',
    }),
    React.createElement('path', {
      d: 'M8.4 12h6.2M8.4 15h4.6',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
    }),
    React.createElement('path', {
      d: 'm16.6 15.1.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8.8-1.9Z',
      fill: accent,
    }),
  );
}

async function apply(ctx) {
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-paper-desk';
  style.textContent = `${katexCss}\n${flowCss}\n${styles}`;
  for (const old of document.head.querySelectorAll('style[data-plugin="dsh-paper-desk"]')) old.remove();
  document.head.appendChild(style);
  ctx.effect(() => () => style.remove(), 'paper-desk: styles');

  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE);
  const feature = ctx.inject(['remote.paperDesk'], (scope) => {
    const api = makeApi(scope.remote.paperDesk);
    const label = () => (isChineseLocale() ? '论文' : 'Papers');

    scope.slots.inject('sidebar.panellist', () => scope.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 30,
      label,
    }, PaperDeskIcon));

    scope.slots.inject('main', () => scope.slots.register({
      name: 'main',
      key: PANEL_ID,
    }, () => React.createElement(PaperDeskApp, { api })));

    // Confirms the browser half and the Host Remote namespace are both live;
    // the Host records a tiny diagnostic marker under projects/.
    void api.clientReady('1.2.0').catch(() => {});
  });

  return async () => {
    await feature.dispose();
    await disposeRemote();
  };
}

export { apply };
export default { inject: ['slots', 'remote'], apply };
