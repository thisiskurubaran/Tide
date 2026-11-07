import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { ActionSheet } from '../../components/ActionSheet';
import { Button } from '../../components/Button';
import { FormSheet } from '../../components/FormSheet';
import { haptic } from '../../components/haptics';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, radius, spacing } from '../../theme/tokens';
import { isValidKey } from './dotenv';
import { envNotIgnored, EnvVariable, ignoreEnv, listVariables, removeVariable, setVariable } from './store';

const WHERE = [
  { value: 'file', label: '.env file' },
  { value: 'keychain', label: 'Keychain (secret)' },
];

// A project's environment variables: plain ones in .env, secrets only in the
// Keychain. Programs run in the terminal get both. Free for everyone.
export function EnvScreen() {
  const { project } = useLocalSearchParams<{ project: string }>();
  const styles = useStyles();
  const colors = useColors();
  const [vars, setVars] = useState<EnvVariable[] | null>(null);
  const [editing, setEditing] = useState<EnvVariable | 'new' | null>(null);
  const [menu, setMenu] = useState<EnvVariable | null>(null);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [exposed, setExposed] = useState(false);

  const reload = useCallback(async () => {
    setVars(await listVariables(project));
    setExposed(await envNotIgnored(project));
  }, [project]);
  useEffect(() => {
    reload();
  }, [reload]);

  const current = editing === 'new' ? null : editing;

  return (
    <Screen title="Environment variables" subtitle={project} testID="env">
      <Text variant="muted">
        Programs you run get these as environment variables, and .http files can use them as {'{{$dotenv NAME}}'}. Secrets stay in this device's Keychain and are never
        written to the project, so they can't be committed or exported.
      </Text>
      {exposed && (
        <View style={styles.warning}>
          <Text variant="label">.env isn't in .gitignore</Text>
          <Text variant="muted">Git would commit its values. Keep secrets in the Keychain, or ignore the file.</Text>
          <Button
            title="Add .env to .gitignore"
            variant="outline"
            onPress={async () => {
              await ignoreEnv(project);
              haptic('success');
              reload();
            }}
            testID="env-ignore"
          />
        </View>
      )}
      <View style={styles.list}>
        {vars?.length === 0 && <Text variant="muted">No variables yet.</Text>}
        {vars?.map((v) => (
          <Pressable
            key={`${v.secret}-${v.key}`}
            onPress={() => setEditing(v)}
            onLongPress={() => setMenu(v)}
            accessibilityRole="button"
            accessibilityHint="Edit; long press for more"
            style={styles.row}
            testID={`env-var-${v.key}`}
          >
            <Feather name={v.secret ? 'lock' : 'file-text'} size={16} color={v.secret ? colors.brand : colors.mutedForeground} />
            <View style={styles.flex}>
              <Text variant="mono" numberOfLines={1}>
                {v.key}
              </Text>
              <Text variant="muted" numberOfLines={1}>
                {v.secret && !shown[v.key] ? '••••••••' : v.value || '(empty)'}
              </Text>
            </View>
            {v.secret && (
              <Pressable
                onPress={() => setShown((s) => ({ ...s, [v.key]: !s[v.key] }))}
                accessibilityRole="button"
                accessibilityLabel={shown[v.key] ? `Hide ${v.key}` : `Show ${v.key}`}
                hitSlop={spacing.sm}
              >
                <Feather name={shown[v.key] ? 'eye-off' : 'eye'} size={16} color={colors.mutedForeground} />
              </Pressable>
            )}
          </Pressable>
        ))}
      </View>
      <Button title="Add a variable" icon="plus" onPress={() => setEditing('new')} testID="env-add" />

      <FormSheet
        visible={editing !== null}
        title={current ? `Edit ${current.key}` : 'New variable'}
        confirmLabel="Save"
        fields={[
          { key: 'key', label: 'Name', mono: true, required: true, initial: current?.key ?? '', placeholder: 'API_KEY' },
          { key: 'value', label: 'Value', mono: true, initial: current?.value ?? '', secure: current?.secret },
          { key: 'where', label: 'Keep it in', choices: WHERE, initial: current?.secret ? 'keychain' : 'file' },
        ]}
        onClose={() => setEditing(null)}
        onSubmit={async ({ key, value, where }) => {
          const name = key.trim();
          if (!isValidKey(name)) throw new Error('Use letters, digits and underscores, not starting with a digit.');
          if (vars?.some((v) => v.key === name && v.key !== current?.key)) throw new Error(`${name} already exists.`);
          await setVariable(project, { key: name, value, secret: where === 'keychain' }, current?.key);
          haptic('success');
          setEditing(null);
          reload();
        }}
      />
      <ActionSheet
        title={menu?.key ?? null}
        actions={
          menu
            ? [
                {
                  label: menu.secret ? 'Move to .env' : 'Move to the Keychain',
                  icon: menu.secret ? 'file-text' : 'lock',
                  onPress: async () => {
                    await setVariable(project, { ...menu, secret: !menu.secret }, menu.key);
                    setMenu(null);
                    reload();
                  },
                },
                {
                  label: 'Delete',
                  icon: 'trash-2',
                  destructive: true,
                  onPress: async () => {
                    await removeVariable(project, menu.key);
                    haptic('success');
                    setMenu(null);
                    reload();
                  },
                },
              ]
            : []
        }
        onClose={() => setMenu(null)}
      />
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { gap: spacing.xs },
  flex: { flex: 1, gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    padding: spacing.sm + 4,
    borderRadius: radius.lg,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  warning: { gap: spacing.xs, padding: spacing.sm + 4, borderRadius: radius.lg, backgroundColor: colors.destructiveSoft },
}));
