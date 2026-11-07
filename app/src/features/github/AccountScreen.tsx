import { router } from 'expo-router';
import { Alert, Image, View } from 'react-native';

import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { makeStyles } from '../../theme/theme';
import { radius, spacing } from '../../theme/tokens';
import { accountStore, useAccount } from './account';
import { SignIn } from './SignIn';

// Settings → GitHub: who's signed in, and signing out.
export function AccountScreen() {
  const styles = useStyles();
  const user = useAccount((s) => s.user);
  return (
    <Screen title="GitHub account" testID="github-account-screen">
      {user ? (
        <View style={styles.box}>
          <Image source={{ uri: user.avatar_url }} style={styles.avatar} accessibilityIgnoresInvertColors />
          <Text variant="title">{user.name ?? user.login}</Text>
          <Text variant="muted">@{user.login}</Text>
          <Text variant="muted" style={styles.center}>
            The same token is used by git (Settings → Git) for cloning and pushing.
          </Text>
          <Button
            title="Sign out"
            variant="outline"
            icon="log-out"
            testID="github-sign-out"
            onPress={() =>
              Alert.alert('Sign out of GitHub?', 'This also removes the token from Settings → Git, so pushing stops working until you sign in again.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: () => accountStore.getState().signOut().then(() => router.back()) },
              ])
            }
          />
        </View>
      ) : (
        <SignIn onDone={() => router.back()} />
      )}
    </Screen>
  );
}

const useStyles = makeStyles(() => ({
  box: { alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  avatar: { width: 72, height: 72, borderRadius: radius.pill },
  center: { textAlign: 'center' },
}));
