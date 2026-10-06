import { Card } from '@pf/design-system';
import { ButtonLink } from '../app/controls';

export function NotFoundScreen() {
  return (
    <Card tint padding="lg" className="pf-empty">
      <h1>Page not found</h1>
      <p className="pf-subtle">That page doesn’t exist or has moved.</p>
      <ButtonLink to="/models">Go to catalogue</ButtonLink>
    </Card>
  );
}
