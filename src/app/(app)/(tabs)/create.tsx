import { Redirect } from 'expo-router';

// The middle tab opens the composer as a modal (see the tab bar). If this
// address is ever opened directly, send it to the composer too.
export default function Create() {
  return <Redirect href="/new-post" />;
}
