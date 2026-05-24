import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HomeScreen from './src/screens/HomeScreen';
// import VibrationTest from './src/screens/VibrationTest';

const App: React.FC = () => {
  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle="light-content"
        backgroundColor="transparent"
        translucent
      />
      <HomeScreen />
      {/* For testing the vibration functionality */}
      {/* <VibrationTest /> */}
    </SafeAreaProvider>
  );
};

export default App;
