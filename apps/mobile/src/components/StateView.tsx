import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, font, radius, space, touch } from "../theme/tokens";

/**
 * 三态视图（加载 / 错误 / 空）—— 全 App 列表/详情屏统一引用。
 *
 * 设计语言（UI-REFERENCES §3）：
 * - 字号≥16sp（正文）、辅助 14sp（仅次要信息）
 * - 点击区≥48dp，主操作"重试"按钮高 56dp、墨绿品牌色
 * - 居中布局 + 充足留白，少用分割线
 * - 图标用 emoji 文字（filled 风格、双编码直白），不依赖图标库
 *
 * 使用：在外层条件分支前包裹列表内容，
 *   <StateView loading={loading} error={error} empty={list.length===0} emptyText="暂无商品" onRetry={reload}>
 *     <FlatList ... />
 *   </StateView>
 * 当 loading/error/empty 任一为真时显示对应态并忽略 children，否则透传 children。
 */
export interface StateViewProps {
  /** 加载中：转圈 + "加载中..." */
  loading?: boolean;
  /** 错误：显示错误信息 + "重试"按钮（onRetry 必传才能重试） */
  error?: string | null;
  /** 空数据：显示 emptyText + 可选 action */
  empty?: boolean;
  /** 空数据文案（默认"暂无数据"） */
  emptyText?: string;
  /** 空数据态可附加大按钮（如"去建档"），点击区≥48dp */
  emptyActionText?: string;
  onEmptyAction?: () => void;
  /** 重试回调；不传则错误态不显示按钮（仅展示信息） */
  onRetry?: () => void;
  children?: ReactNode;
}

export function StateView({
  loading,
  error,
  empty,
  emptyText = "暂无数据",
  emptyActionText,
  onEmptyAction,
  onRetry,
  children,
}: StateViewProps) {
  if (loading) {
    return (
      <View style={styles.wrap}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.tip}>加载中...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.icon} accessibilityLabel="警告">
          ⚠️
        </Text>
        <Text style={styles.message}>{error}</Text>
        {onRetry ? (
          <Pressable
            style={({ pressed }) => [styles.retryBtn, pressed && styles.retryPressed]}
            hitSlop={8}
            onPress={onRetry}
          >
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (empty) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.icon} accessibilityLabel="空">
          📭
        </Text>
        <Text style={styles.message}>{emptyText}</Text>
        {emptyActionText && onEmptyAction ? (
          <Pressable
            style={({ pressed }) => [styles.retryBtn, pressed && styles.retryPressed]}
            hitSlop={8}
            onPress={onEmptyAction}
          >
            <Text style={styles.retryText}>{emptyActionText}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.md,
    padding: space.xxl,
  },
  tip: { fontSize: font.body, color: colors.textMuted, marginTop: space.sm },
  icon: { fontSize: 48 },
  message: {
    fontSize: font.body,
    color: colors.text,
    textAlign: "center",
    lineHeight: 24,
  },
  retryBtn: {
    backgroundColor: colors.primary,
    height: touch.buttonHeight,
    borderRadius: radius.md,
    paddingHorizontal: space.xxl + space.lg,
    alignItems: "center",
    justifyContent: "center",
    minWidth: touch.minSize * 3,
  },
  retryPressed: { backgroundColor: colors.primaryPressed },
  retryText: { color: "#fff", fontSize: font.body, fontWeight: "800" },
});
