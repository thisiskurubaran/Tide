// Jest: UIKit's sheet doesn't exist here. Render the content while the sheet
// is open and report the transitions straight away, so tests see the same
// tree as the drawn Modal sheet (nothing while closed).
const React = require('react');
const { View } = require('react-native');

function FormSheet({ isOpen, children, onDidAppear, onDidDisappear }) {
  const was = React.useRef(false);
  React.useEffect(() => {
    if (isOpen === was.current) return;
    was.current = isOpen;
    const handler = isOpen ? onDidAppear : onDidDisappear;
    handler?.({ nativeEvent: {} });
  }, [isOpen, onDidAppear, onDidDisappear]);
  return isOpen ? React.createElement(View, { testID: 'native-form-sheet' }, children) : null;
}

module.exports = { FormSheet };
