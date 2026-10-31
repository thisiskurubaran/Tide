import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { ActionSheet } from '../../components/ActionSheet';
import { Button, IconButton } from '../../components/Button';
import { FormSheet } from '../../components/FormSheet';
import { haptic } from '../../components/haptics';
import { Empty, Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { settingsStore, useSettings } from '../../state';
import { makeStyles } from '../../theme/theme';
import { borderWidth, radius, spacing } from '../../theme/tokens';
import type { Language, Snippet } from '../editor/bridge';
import { requirePro, useIsPro } from '../pro';

const LANGUAGES: { value: '' | Language; label: string }[] = [
  { value: '', label: 'Any' },
  { value: 'javascript', label: 'JS / TS' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'php', label: 'PHP' },
  { value: 'lua', label: 'Lua' },
  { value: 'sql', label: 'SQL' },
  { value: 'markdown', label: 'Markdown' },
];

const EXAMPLES: Snippet[] = [
  { prefix: 'log', body: 'console.log($1);', description: 'console.log', languages: ['javascript'] },
  { prefix: 'afn', body: 'const ${1:name} = async (${2}) => {\n  $0\n};', description: 'async arrow function', languages: ['javascript'] },
  { prefix: 'main', body: 'def main():\n    $0\n\n\nif __name__ == "__main__":\n    main()', description: 'main guard', languages: ['python'] },
  { prefix: 'todo', body: 'TODO(${1:me}): $0', description: 'a TODO note' },
];

const label = (s: Snippet) => LANGUAGES.find((l) => l.value === (s.languages?.[0] ?? ''))?.label ?? s.languages?.join(', ');

// Your snippets: typing a prefix in the editor offers the body, with tab stops
// ($1, ${2:name}, $0) as in VS Code. Tide Pro.
export function SnippetsScreen() {
  const styles = useStyles();
  const snippets = useSettings((s) => s.snippets);
  const pro = useIsPro();
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const current = editing?.index !== null && editing ? snippets[editing.index] : null;
  const save = (next: Snippet[]) => settingsStore.getState().setSnippets(next);
  const add = () => requirePro('snippets') && setEditing({ index: null });

  return (
    <Screen
      title="Snippets"
      subtitle={pro ? 'Type a prefix in the editor' : 'Tide Pro'}
      actions={<IconButton icon="plus" label="Add a snippet" onPress={add} testID="snippet-add" />}
      testID="snippets"
    >
      {snippets.length === 0 && (
        <Empty title="No snippets yet" body="Type a snippet's prefix in the editor and pick it from the suggestions; Tab moves between its $1, $2 placeholders. Emmet, also in Pro, expands ul>li*3 and friends with Tab.">
          <Button title="Add a snippet" icon="plus" onPress={add} />
          <Button
            title="Start with examples"
            variant="outline"
            onPress={() => {
              if (!requirePro('snippets')) return;
              save(EXAMPLES);
              haptic('success');
            }}
            testID="snippet-examples"
          />
        </Empty>
      )}
      {snippets.map((s, i) => (
        <Pressable key={`${s.prefix}-${i}`} onPress={() => setMenu(i)} accessibilityRole="button" style={styles.row} testID={`snippet-${s.prefix}`}>
          <View style={styles.head}>
            <Text variant="mono">{s.prefix}</Text>
            <Text variant="muted">{label(s)}</Text>
          </View>
          {s.description ? <Text variant="muted">{s.description}</Text> : null}
          <Text variant="mono" numberOfLines={3} style={styles.body}>
            {s.body}
          </Text>
        </Pressable>
      ))}

      <ActionSheet
        title={menu !== null ? snippets[menu]?.prefix ?? null : null}
        onClose={() => setMenu(null)}
        actions={
          menu === null
            ? []
            : [
                { label: 'Edit', icon: 'edit-2', onPress: () => (setMenu(null), requirePro('snippets') && setEditing({ index: menu })) },
                {
                  label: 'Delete',
                  icon: 'trash-2',
                  destructive: true,
                  onPress: () => {
                    save(snippets.filter((_, j) => j !== menu));
                    setMenu(null);
                  },
                },
              ]
        }
      />
      <FormSheet
        visible={editing !== null}
        title={current ? `Edit ${current.prefix}` : 'New snippet'}
        confirmLabel="Save"
        fields={[
          { key: 'prefix', label: 'Prefix', mono: true, required: true, placeholder: 'log', initial: current?.prefix ?? '' },
          {
            key: 'body',
            label: 'Body',
            mono: true,
            multiline: true,
            required: true,
            placeholder: 'console.log($1);',
            initial: current?.body ?? '',
            hint: '$1, $2 are tab stops, ${1:name} has a placeholder, $0 is where the cursor ends.',
          },
          { key: 'description', label: 'Description', placeholder: 'Optional', initial: current?.description ?? '' },
          { key: 'language', label: 'Language', choices: LANGUAGES, initial: current?.languages?.[0] ?? '' },
        ]}
        onClose={() => setEditing(null)}
        onSubmit={async ({ prefix, body, description, language }) => {
          const p = prefix.trim();
          if (/\s/.test(p)) throw new Error('A prefix is one word, without spaces.');
          const snippet: Snippet = { prefix: p, body, ...(description.trim() ? { description: description.trim() } : {}), ...(language ? { languages: [language as Language] } : {}) };
          const next = [...snippets];
          if (editing?.index !== null && editing) next[editing.index] = snippet;
          else next.push(snippet);
          save(next.sort((a, b) => a.prefix.localeCompare(b.prefix)));
          haptic('success');
          setEditing(null);
        }}
      />
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { gap: spacing.xs, padding: spacing.sm + 4, borderRadius: radius.lg, borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  body: { opacity: 0.85 },
}));
