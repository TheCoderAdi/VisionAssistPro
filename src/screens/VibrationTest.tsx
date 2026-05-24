import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Vibration,
  Platform,
  NativeModules,
} from 'react-native';

// ─── Test every possible vibration method ────────────────────────────────────
// Run each test one by one and note which ones you FEEL

const log = (msg: string) => console.log(`[VibTest] ${msg}`);

const VibrationTest: React.FC = () => {
  const [results, setResults] = useState<string[]>([]);
  const [lastTested, setLastTested] = useState('');

  const addResult = (msg: string) => {
    setResults(prev => [
      `${new Date().toLocaleTimeString()} - ${msg}`,
      ...prev,
    ]);
  };

  // TEST 1: Simplest possible — single number
  const test1 = () => {
    setLastTested('Test 1: Single 500ms');
    log('Test1: Vibration.vibrate(500)');
    try {
      Vibration.vibrate(500);
      addResult('✅ Test1 called: Vibration.vibrate(500)');
    } catch (e: any) {
      addResult(`❌ Test1 error: ${e.message}`);
    }
  };

  // TEST 2: Very long single vibration — hard to miss
  const test2 = () => {
    setLastTested('Test 2: Single 2000ms');
    log('Test2: Vibration.vibrate(2000)');
    try {
      Vibration.vibrate(2000);
      addResult('✅ Test2 called: Vibration.vibrate(2000)');
    } catch (e: any) {
      addResult(`❌ Test2 error: ${e.message}`);
    }
  };

  // TEST 3: Pattern starting with 0 (standard RN format)
  const test3 = () => {
    setLastTested('Test 3: Pattern [0, 500]');
    log('Test3: Vibration.vibrate([0, 500])');
    try {
      Vibration.vibrate([0, 500]);
      addResult('✅ Test3 called: pattern [0, 500]');
    } catch (e: any) {
      addResult(`❌ Test3 error: ${e.message}`);
    }
  };

  // TEST 4: Pattern starting with non-zero (Funtouch fix)
  const test4 = () => {
    setLastTested('Test 4: Pattern [50, 500]');
    log('Test4: Vibration.vibrate([50, 500])');
    try {
      Vibration.vibrate([50, 500]);
      addResult('✅ Test4 called: pattern [50, 500]');
    } catch (e: any) {
      addResult(`❌ Test4 error: ${e.message}`);
    }
  };

  // TEST 5: Pattern with repeat
  const test5 = () => {
    setLastTested('Test 5: Pattern [100, 300, 100, 300] repeat');
    log('Test5: Vibration.vibrate([100, 300, 100, 300], true)');
    try {
      Vibration.vibrate([100, 300, 100, 300], true);
      addResult('✅ Test5 called: repeating pattern');
      // Cancel after 2s
      setTimeout(() => {
        Vibration.cancel();
        addResult('✅ Test5 cancelled after 2s');
      }, 2000);
    } catch (e: any) {
      addResult(`❌ Test5 error: ${e.message}`);
    }
  };

  // TEST 6: Cancel
  const test6 = () => {
    setLastTested('Test 6: Cancel');
    try {
      Vibration.cancel();
      addResult('✅ Test6: Vibration.cancel() called');
    } catch (e: any) {
      addResult(`❌ Test6 error: ${e.message}`);
    }
  };

  // TEST 7: Wake + pattern combo (our current fix)
  const test7 = () => {
    setLastTested('Test 7: Wake pulse then pattern');
    log('Test7: wake pulse + pattern');
    try {
      Vibration.vibrate(80);
      addResult('✅ Test7a: wake pulse sent');
      setTimeout(() => {
        Vibration.vibrate([50, 600, 100, 600]);
        addResult('✅ Test7b: pattern sent after 150ms');
      }, 150);
    } catch (e: any) {
      addResult(`❌ Test7 error: ${e.message}`);
    }
  };

  // TEST 8: Check if Android vibrator is accessible via NativeModules
  const test8 = () => {
    setLastTested('Test 8: NativeModules check');
    const modules = Object.keys(NativeModules).join(', ');
    log(`NativeModules: ${modules}`);
    addResult(`📋 NativeModules: ${modules.substring(0, 100)}...`);
    addResult(`📱 Platform: ${Platform.OS} ${Platform.Version}`);
  };

  // TEST 9: Three quick bursts — if nothing else works, this should
  const test9 = () => {
    setLastTested('Test 9: 3 quick bursts 1s apart');
    [0, 1000, 2000].forEach(delay => {
      setTimeout(() => {
        Vibration.vibrate(300);
        addResult(`✅ Test9: burst at ${delay}ms`);
      }, delay);
    });
  };

  const clearResults = () => setResults([]);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Vibration Diagnostics</Text>
      <Text style={styles.subtitle}>
        {Platform.OS} {Platform.Version} | Tap each test and feel for vibration
      </Text>

      {lastTested ? (
        <View style={styles.lastTested}>
          <Text style={styles.lastTestedText}>Last: {lastTested}</Text>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Test buttons */}
        <View style={styles.grid}>
          {[
            { fn: test1, label: 'T1\nSingle 500ms', color: '#007AFF' },
            { fn: test2, label: 'T2\nSingle 2000ms', color: '#007AFF' },
            { fn: test3, label: 'T3\nPattern [0,500]', color: '#FF9500' },
            { fn: test4, label: 'T4\nPattern [50,500]', color: '#FF9500' },
            { fn: test5, label: 'T5\nRepeat pattern', color: '#34C759' },
            { fn: test6, label: 'T6\nCANCEL', color: '#FF3B30' },
            { fn: test7, label: 'T7\nWake+Pattern', color: '#AF52DE' },
            { fn: test8, label: 'T8\nModule info', color: '#5856D6' },
            { fn: test9, label: 'T9\n3 bursts', color: '#FF2D55' },
          ].map(({ fn, label, color }, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.btn, { backgroundColor: color }]}
              onPress={fn}
              activeOpacity={0.7}
            >
              <Text style={styles.btnText}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Instructions */}
        <View style={styles.instructions}>
          <Text style={styles.instrTitle}>Instructions:</Text>
          <Text style={styles.instrText}>
            1. Start with T1 (single 500ms) — simplest possible{'\n'}
            2. If T1 works, try T3 vs T4 to see if leading-0 is blocked{'\n'}
            3. If T1 does NOT work, the issue is system-level{'\n'}
            4. Check: Settings → Sound & Vibration → Vibration is ON{'\n'}
            5. Check: iQOO does not have "vibration off" in volume buttons{'\n'}
            6. Note which tests you FEEL and report back
          </Text>
        </View>

        {/* Log */}
        <View style={styles.logHeader}>
          <Text style={styles.logTitle}>Log</Text>
          <TouchableOpacity onPress={clearResults}>
            <Text style={styles.clearBtn}>Clear</Text>
          </TouchableOpacity>
        </View>
        {results.length === 0 ? (
          <Text style={styles.emptyLog}>Tap a test button above...</Text>
        ) : (
          results.map((r, i) => (
            <Text key={i} style={styles.logLine}>
              {r}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', paddingTop: 60 },
  title: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: '#8E8E93',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  lastTested: {
    backgroundColor: '#1C1C1E',
    marginHorizontal: 16,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  lastTestedText: { color: '#00FF88', fontSize: 13, textAlign: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 60 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  btn: {
    width: '30%',
    aspectRatio: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  btnText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  instructions: {
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  instrTitle: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  instrText: { color: '#8E8E93', fontSize: 12, lineHeight: 20 },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  logTitle: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  clearBtn: { color: '#FF3B30', fontSize: 13 },
  emptyLog: { color: '#444', fontSize: 12, textAlign: 'center', marginTop: 20 },
  logLine: {
    color: '#CCC',
    fontSize: 11,
    fontFamily: 'monospace',
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: '#222',
  },
});

export default VibrationTest;
