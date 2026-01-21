import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

// 通知の設定
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// 型定義
interface AlarmSettings {
  weekday: { targetTime: string; minRandom: number; maxRandom: number };
  weekend: { targetTime: string; minRandom: number; maxRandom: number };
  spoilerFree: boolean;
}

interface HistoryItem {
  date: string;
  savedMinutes: number;
  targetTime: string;
  actualTime: string;
}

interface AppData {
  settings: AlarmSettings;
  history: HistoryItem[];
  totalSaved: number;
}


// 得した時間の使い方提案
const suggestions = [
  { min: 1, max: 5, activities: ['ゆっくり深呼吸してみよう', '今日の目標を考えてみよう', '水を一杯飲もう'] },
  { min: 6, max: 10, activities: ['簡単なストレッチをしよう', 'SNSをチェックできるよ', 'お気に入りの音楽を1曲聴こう'] },
  { min: 11, max: 20, activities: ['しっかりストレッチできる！', '朝ごはんをゆっくり食べよう', 'ニュースをチェックしよう'] },
  { min: 21, max: 30, activities: ['朝の散歩ができるよ！', '本を数ページ読めるね', 'しっかり朝食を作ろう'] },
  { min: 31, max: 60, activities: ['朝活の時間だ！何でもできる！', '運動してから出かけられる', '趣味の時間に使おう'] },
];

const getSuggestion = (minutes: number): string => {
  const category = suggestions.find(s => minutes >= s.min && minutes <= s.max);
  if (category) {
    return category.activities[Math.floor(Math.random() * category.activities.length)];
  }
  return 'すごい！たっぷり時間がある！';
};

const STORAGE_KEY = 'luckyAlarm';

const defaultData: AppData = {
  settings: {
    weekday: { targetTime: '07:00', minRandom: 5, maxRandom: 30 },
    weekend: { targetTime: '09:00', minRandom: 5, maxRandom: 30 },
    spoilerFree: false,
  },
  history: [],
  totalSaved: 0,
};

export default function App() {
  const [currentTime, setCurrentTime] = useState('--:--');
  const [data, setData] = useState<AppData>(defaultData);
  const [selectedDay, setSelectedDay] = useState<'weekday' | 'weekend'>('weekday');
  const [alarmActive, setAlarmActive] = useState(false);
  const [savedMinutes, setSavedMinutes] = useState(0);
  const [alarmId, setAlarmId] = useState<string | null>(null);
  const [alarmTime, setAlarmTime] = useState<string | null>(null);

  // データ読み込み
  useEffect(() => {
    loadData();

    // 今日が週末なら週末タブを選択
    const day = new Date().getDay();
    if (day === 0 || day === 6) {
      setSelectedDay('weekend');
    }
  }, []);

  // 時計更新
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      if (!data.settings.spoilerFree || !alarmActive) {
        setCurrentTime(
          `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        );
      } else {
        setCurrentTime('??:??');
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [data.settings.spoilerFree, alarmActive]);

  const loadData = async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved) {
        setData(JSON.parse(saved));
      }
    } catch (e) {
      console.log('データ読み込みエラー:', e);
    }
  };

  const saveData = async (newData: AppData) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      setData(newData);
    } catch (e) {
      console.log('データ保存エラー:', e);
    }
  };

  // 通知許可をリクエスト
  const requestAlarmPermission = async (): Promise<boolean> => {
    if (!Device.isDevice) {
      Alert.alert('実機が必要', '通知は実機でのみ動作します');
      return false;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      Alert.alert('許可が必要', '通知の許可を設定から有効にしてください');
      return false;
    }

    return true;
  };

  // アラームをセット
  const setAlarm = async () => {
    const hasPermission = await requestAlarmPermission();
    if (!hasPermission) {
      Alert.alert('許可が必要', 'アラームを設定するには許可が必要です');
      return;
    }

    const settings = data.settings[selectedDay];
    const { targetTime, minRandom, maxRandom } = settings;

    // ランダムな分数を決定
    const randomMinutes = Math.floor(Math.random() * (maxRandom - minRandom + 1)) + minRandom;
    setSavedMinutes(randomMinutes);

    // アラーム時刻を計算
    const [targetH, targetM] = targetTime.split(':').map(Number);
    const now = new Date();
    const alarmDate = new Date(now);
    alarmDate.setHours(targetH, targetM, 0, 0);

    // 目標時刻からランダム分数を引く
    alarmDate.setMinutes(alarmDate.getMinutes() - randomMinutes);

    // 過去の時刻なら翌日に設定
    if (alarmDate <= now) {
      alarmDate.setDate(alarmDate.getDate() + 1);
    }

    const alarmTimeStr = `${String(alarmDate.getHours()).padStart(2, '0')}:${String(alarmDate.getMinutes()).padStart(2, '0')}`;
    setAlarmTime(alarmTimeStr);

    try {
      // expo-notificationsでスケジュール
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Lucky Alarm',
          body: `${randomMinutes}分得した！ ${getSuggestion(randomMinutes)}`,
          sound: true,
          priority: Notifications.AndroidNotificationPriority.MAX,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: alarmDate,
        },
      });
      setAlarmId(id);
      setAlarmActive(true);

      Alert.alert(
        'アラームセット完了',
        `目標: ${targetTime}\n${randomMinutes}分前に鳴ります\n\n何時に鳴るかはお楽しみ！`,
        [{ text: 'OK' }]
      );

      console.log(`アラーム設定: ${alarmTimeStr} (目標: ${targetTime}, ${randomMinutes}分前)`);

    } catch (e) {
      console.log('アラーム設定エラー:', e);
      Alert.alert('エラー', 'アラームの設定に失敗しました');
    }
  };

  // アラームをキャンセル
  const cancelAlarm = async () => {
    if (alarmId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(alarmId);
      } catch (e) {
        console.log('キャンセルエラー:', e);
      }
    }
    setAlarmActive(false);
    setAlarmId(null);
    setAlarmTime(null);
    setSavedMinutes(0);
    Alert.alert('アラーム解除', 'アラームを解除しました');
  };

  // 設定を更新
  const updateSetting = (key: 'minRandom' | 'maxRandom', value: number) => {
    const newData = { ...data };
    newData.settings[selectedDay][key] = value;
    saveData(newData);
  };

  // 時刻を更新
  const updateTargetTime = (direction: 'up' | 'down', unit: 'hour' | 'minute') => {
    const newData = { ...data };
    const [h, m] = newData.settings[selectedDay].targetTime.split(':').map(Number);
    let newH = h;
    let newM = m;

    if (unit === 'hour') {
      newH = direction === 'up' ? (h + 1) % 24 : (h - 1 + 24) % 24;
    } else {
      newM = direction === 'up' ? (m + 5) % 60 : (m - 5 + 60) % 60;
    }

    newData.settings[selectedDay].targetTime =
      `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
    saveData(newData);
  };

  // 今週の合計を計算
  const getWeeklySaved = (): number => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    return data.history
      .filter(h => new Date(h.date) >= weekStart)
      .reduce((sum, h) => sum + h.savedMinutes, 0);
  };

  const currentSettings = data.settings[selectedDay];

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* ヘッダー */}
        <View style={styles.header}>
          <Text style={styles.title}>Lucky Alarm</Text>
          <Text style={styles.subtitle}>毎朝ちょっと得する目覚まし</Text>
        </View>

        {/* 時計 */}
        <View style={styles.clockSection}>
          <Text style={styles.clock}>
            {data.settings.spoilerFree && alarmActive ? 'お楽しみ' : currentTime}
          </Text>
        </View>

        {/* 統計カード */}
        <View style={styles.statsCard}>
          <Text style={styles.statsLabel}>今週得した時間</Text>
          <Text style={styles.statsValue}>{getWeeklySaved()}分</Text>
          <Text style={styles.statsSubLabel}>累計: {data.totalSaved}分</Text>
        </View>

        {/* アラーム設定 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>アラーム設定</Text>

          {/* 曜日選択 */}
          <View style={styles.daySelector}>
            <TouchableOpacity
              style={[styles.dayBtn, selectedDay === 'weekday' && styles.dayBtnActive]}
              onPress={() => setSelectedDay('weekday')}
            >
              <Text style={[styles.dayBtnText, selectedDay === 'weekday' && styles.dayBtnTextActive]}>
                平日
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dayBtn, selectedDay === 'weekend' && styles.dayBtnActive]}
              onPress={() => setSelectedDay('weekend')}
            >
              <Text style={[styles.dayBtnText, selectedDay === 'weekend' && styles.dayBtnTextActive]}>
                休日
              </Text>
            </TouchableOpacity>
          </View>

          {/* 目標起床時刻 */}
          <View style={styles.settingGroup}>
            <Text style={styles.settingLabel}>目標起床時刻</Text>
            <View style={styles.timePicker}>
              <View style={styles.timeUnit}>
                <TouchableOpacity
                  style={styles.timeBtn}
                  onPress={() => updateTargetTime('up', 'hour')}
                >
                  <Text style={styles.timeBtnText}>+</Text>
                </TouchableOpacity>
                <Text style={styles.timeValue}>
                  {currentSettings.targetTime.split(':')[0]}
                </Text>
                <TouchableOpacity
                  style={styles.timeBtn}
                  onPress={() => updateTargetTime('down', 'hour')}
                >
                  <Text style={styles.timeBtnText}>-</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.timeColon}>:</Text>
              <View style={styles.timeUnit}>
                <TouchableOpacity
                  style={styles.timeBtn}
                  onPress={() => updateTargetTime('up', 'minute')}
                >
                  <Text style={styles.timeBtnText}>+</Text>
                </TouchableOpacity>
                <Text style={styles.timeValue}>
                  {currentSettings.targetTime.split(':')[1]}
                </Text>
                <TouchableOpacity
                  style={styles.timeBtn}
                  onPress={() => updateTargetTime('down', 'minute')}
                >
                  <Text style={styles.timeBtnText}>-</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* ランダム範囲 */}
          <View style={styles.settingGroup}>
            <Text style={styles.settingLabel}>ランダム範囲（何分前に鳴るか）</Text>
            <View style={styles.rangeContainer}>
              <View style={styles.rangeInput}>
                <Text style={styles.rangeLabel}>最小</Text>
                <View style={styles.rangeValue}>
                  <TouchableOpacity
                    style={styles.rangeBtn}
                    onPress={() => updateSetting('minRandom', Math.max(1, currentSettings.minRandom - 5))}
                  >
                    <Text style={styles.rangeBtnText}>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.rangeNumber}>{currentSettings.minRandom}</Text>
                  <TouchableOpacity
                    style={styles.rangeBtn}
                    onPress={() => updateSetting('minRandom', Math.min(currentSettings.maxRandom - 1, currentSettings.minRandom + 5))}
                  >
                    <Text style={styles.rangeBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.rangeUnit}>分前</Text>
              </View>
              <View style={styles.rangeInput}>
                <Text style={styles.rangeLabel}>最大</Text>
                <View style={styles.rangeValue}>
                  <TouchableOpacity
                    style={styles.rangeBtn}
                    onPress={() => updateSetting('maxRandom', Math.max(currentSettings.minRandom + 1, currentSettings.maxRandom - 5))}
                  >
                    <Text style={styles.rangeBtnText}>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.rangeNumber}>{currentSettings.maxRandom}</Text>
                  <TouchableOpacity
                    style={styles.rangeBtn}
                    onPress={() => updateSetting('maxRandom', Math.min(60, currentSettings.maxRandom + 5))}
                  >
                    <Text style={styles.rangeBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.rangeUnit}>分前</Text>
              </View>
            </View>
          </View>

          {/* ネタバレ防止モード */}
          <View style={styles.toggleGroup}>
            <View style={styles.toggleInfo}>
              <Text style={styles.settingLabel}>ネタバレ防止モード</Text>
              <Text style={styles.settingDesc}>アラームが鳴るまで現在時刻を隠す</Text>
            </View>
            <Switch
              value={data.settings.spoilerFree}
              onValueChange={(value) => {
                const newData = { ...data };
                newData.settings.spoilerFree = value;
                saveData(newData);
              }}
              trackColor={{ false: '#3e3e5e', true: '#6c5ce7' }}
              thumbColor="#fff"
            />
          </View>

          {/* アラームボタン */}
          <TouchableOpacity
            style={[styles.alarmBtn, alarmActive && styles.alarmBtnActive]}
            onPress={alarmActive ? cancelAlarm : setAlarm}
          >
            <Text style={styles.alarmBtnText}>
              {alarmActive ? 'アラーム解除' : 'アラームをセット'}
            </Text>
          </TouchableOpacity>

          {alarmActive && (
            <Text style={styles.alarmInfo}>
              アラームセット中... 何分前に鳴るかはお楽しみ！
            </Text>
          )}
        </View>

        {/* 履歴 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>最近の記録</Text>
          {data.history.length === 0 ? (
            <Text style={styles.emptyText}>まだ記録がありません</Text>
          ) : (
            data.history.slice(0, 7).map((item, index) => {
              const date = new Date(item.date);
              const days = ['日', '月', '火', '水', '木', '金', '土'];
              const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${days[date.getDay()]}`;
              return (
                <View key={index} style={styles.historyItem}>
                  <Text style={styles.historyDate}>{dateStr}</Text>
                  <Text style={styles.historySaved}>+{item.savedMinutes}分</Text>
                </View>
              );
            })
          )}
        </View>

        {/* フッター */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Lucky Alarm v1.0</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#6c5ce7',
  },
  subtitle: {
    fontSize: 14,
    color: '#a0a0a0',
    marginTop: 5,
  },
  clockSection: {
    alignItems: 'center',
    marginBottom: 25,
  },
  clock: {
    fontSize: 64,
    fontWeight: '700',
    color: '#eaeaea',
  },
  statsCard: {
    backgroundColor: '#6c5ce7',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 25,
  },
  statsLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
  },
  statsValue: {
    fontSize: 42,
    fontWeight: '700',
    color: '#fff',
    marginVertical: 5,
  },
  statsSubLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
  },
  section: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#eaeaea',
    marginBottom: 20,
  },
  daySelector: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  dayBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#6c5ce7',
    alignItems: 'center',
  },
  dayBtnActive: {
    backgroundColor: '#6c5ce7',
  },
  dayBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6c5ce7',
  },
  dayBtnTextActive: {
    color: '#fff',
  },
  settingGroup: {
    marginBottom: 20,
  },
  settingLabel: {
    fontSize: 14,
    color: '#a0a0a0',
    marginBottom: 10,
  },
  settingDesc: {
    fontSize: 12,
    color: '#808080',
  },
  timePicker: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f3460',
    borderRadius: 12,
    padding: 15,
  },
  timeUnit: {
    alignItems: 'center',
  },
  timeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#6c5ce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeBtnText: {
    fontSize: 24,
    color: '#fff',
    fontWeight: '600',
  },
  timeValue: {
    fontSize: 48,
    color: '#eaeaea',
    fontWeight: '700',
    marginVertical: 10,
  },
  timeColon: {
    fontSize: 48,
    color: '#eaeaea',
    fontWeight: '700',
    marginHorizontal: 10,
  },
  rangeContainer: {
    flexDirection: 'row',
    gap: 15,
  },
  rangeInput: {
    flex: 1,
    backgroundColor: '#0f3460',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  rangeLabel: {
    fontSize: 12,
    color: '#a0a0a0',
    marginBottom: 8,
  },
  rangeValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rangeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#6c5ce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeBtnText: {
    fontSize: 20,
    color: '#fff',
    fontWeight: '600',
  },
  rangeNumber: {
    fontSize: 24,
    color: '#eaeaea',
    fontWeight: '600',
    minWidth: 40,
    textAlign: 'center',
  },
  rangeUnit: {
    fontSize: 12,
    color: '#a0a0a0',
    marginTop: 8,
  },
  toggleGroup: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  toggleInfo: {
    flex: 1,
  },
  alarmBtn: {
    backgroundColor: '#6c5ce7',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
  },
  alarmBtnActive: {
    backgroundColor: '#e17055',
  },
  alarmBtnText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  alarmInfo: {
    textAlign: 'center',
    color: '#a0a0a0',
    marginTop: 10,
    fontSize: 13,
  },
  emptyText: {
    color: '#a0a0a0',
    textAlign: 'center',
    padding: 20,
  },
  historyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  historyDate: {
    color: '#a0a0a0',
    fontSize: 14,
  },
  historySaved: {
    color: '#00b894',
    fontWeight: '600',
    fontSize: 14,
  },
  footer: {
    alignItems: 'center',
    marginTop: 10,
  },
  footerText: {
    color: '#606080',
    fontSize: 12,
  },
});
