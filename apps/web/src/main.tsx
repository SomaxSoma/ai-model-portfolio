// Design-system tokens and components first, then the app layer.
import '@pf/design-system/tokens/fonts.css';
import '@pf/design-system/tokens/colors.css';
import '@pf/design-system/tokens/typography.css';
import '@pf/design-system/tokens/spacing.css';
import '@pf/design-system/tokens/base.css';
import '@pf/design-system/styles.css';
import './theme.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
