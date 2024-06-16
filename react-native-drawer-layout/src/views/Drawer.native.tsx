import * as React from 'react';
import {
  I18nManager,
  Platform,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import useLatestCallback from 'use-latest-callback';

import type { DrawerProps } from '../types';
import { DrawerProgressContext } from '../utils/DrawerProgressContext';
import { getDrawerWidth } from '../utils/getDrawerWidth';

import { Overlay } from './Overlay';

const minmax = (value: number, start: number, end: number) => {
  'worklet';

  return Math.min(Math.max(value, start), end);
};

export function Drawer({
  layout: customLayout,
  drawerPosition = I18nManager.getConstants().isRTL ? 'right' : 'left',
  drawerStyle,
  drawerType = 'front',
  hideStatusBarOnOpen = false,
  onClose,
  onOpen,
  onTransitionStart,
  onTransitionEnd,
  open,
  overlayStyle,
  overlayAccessibilityLabel,
  statusBarAnimation = 'slide',
  renderDrawerContent,
  children,
  style,
}: DrawerProps) {
  const windowDimensions = useWindowDimensions();

  const layout = customLayout ?? windowDimensions;
  const drawerWidth = getDrawerWidth({ layout, drawerStyle });

  const isOpen = drawerType === 'permanent' ? true : open;
  const isRight = drawerPosition === 'right';

  const getDrawerTranslationX = React.useCallback(
    (open: boolean) => {
      'worklet';

      if (drawerPosition === 'left') {
        return open ? 0 : -drawerWidth;
      }

      return open ? 0 : drawerWidth;
    },
    [drawerPosition, drawerWidth]
  );

  const hideStatusBar = React.useCallback(
    (hide: boolean) => {
      if (hideStatusBarOnOpen) {
        StatusBar.setHidden(hide, statusBarAnimation);
      }
    },
    [hideStatusBarOnOpen, statusBarAnimation]
  );

  React.useEffect(() => {
    hideStatusBar(isOpen);

    return () => hideStatusBar(false);
  }, [isOpen, hideStatusBarOnOpen, statusBarAnimation, hideStatusBar]);

  const touchStartX = useSharedValue(0);
  const touchX = useSharedValue(0);
  const translationX = useSharedValue(getDrawerTranslationX(open));

  const handleAnimationStart = useLatestCallback((open: boolean) => {
    onTransitionStart?.(!open);
  });

  const handleAnimationEnd = useLatestCallback(
    (open: boolean, finished?: boolean) => {
      if (!finished) return;
      onTransitionEnd?.(!open);
    }
  );

  const toggleDrawer = React.useCallback(
    (open: boolean, velocity?: number) => {
      'worklet';

      const translateX = getDrawerTranslationX(open);

      if (velocity === undefined) {
        runOnJS(handleAnimationStart)(open);
      }

      touchStartX.value = 0;
      touchX.value = 0;
      translationX.value = withSpring(
        translateX,
        {
          velocity,
          stiffness: 1000,
          damping: 500,
          mass: 3,
          overshootClamping: true,
          restDisplacementThreshold: 0.01,
          restSpeedThreshold: 0.01,
        },
        (finished) => runOnJS(handleAnimationEnd)(open, finished)
      );

      if (open) {
        runOnJS(onOpen)();
      } else {
        runOnJS(onClose)();
      }
    },
    [
      getDrawerTranslationX,
      handleAnimationEnd,
      handleAnimationStart,
      onClose,
      onOpen,
      touchStartX,
      touchX,
      translationX,
    ]
  );

  React.useEffect(() => toggleDrawer(open), [open, toggleDrawer]);

  const translateX = useDerivedValue(() => {
    // Comment stolen from react-native-gesture-handler/DrawerLayout
    //
    // While closing the drawer when user starts gesture outside of its area (in greyed
    // out part of the window), we want the drawer to follow only once finger reaches the
    // edge of the drawer.
    // E.g. on the diagram below drawer is illustrate by X signs and the greyed out area by
    // dots. The touch gesture starts at '*' and moves left, touch path is indicated by
    // an arrow pointing left
    // 1) +---------------+ 2) +---------------+ 3) +---------------+ 4) +---------------+
    //    |XXXXXXXX|......|    |XXXXXXXX|......|    |XXXXXXXX|......|    |XXXXX|.........|
    //    |XXXXXXXX|......|    |XXXXXXXX|......|    |XXXXXXXX|......|    |XXXXX|.........|
    //    |XXXXXXXX|......|    |XXXXXXXX|......|    |XXXXXXXX|......|    |XXXXX|.........|
    //    |XXXXXXXX|......|    |XXXXXXXX|.<-*..|    |XXXXXXXX|<--*..|    |XXXXX|<-----*..|
    //    |XXXXXXXX|......|    |XXXXXXXX|......|    |XXXXXXXX|......|    |XXXXX|.........|
    //    |XXXXXXXX|......|    |XXXXXXXX|......|    |XXXXXXXX|......|    |XXXXX|.........|
    //    |XXXXXXXX|......|    |XXXXXXXX|......|    |XXXXXXXX|......|    |XXXXX|.........|
    //    +---------------+    +---------------+    +---------------+    +---------------+
    //
    // For the above to work properly we define animated value that will keep start position
    // of the gesture. Then we use that value to calculate how much we need to subtract from
    // the translationX. If the gesture started on the greyed out area we take the distance from the
    // edge of the drawer to the start position. Otherwise we don't subtract at all and the
    // drawer be pulled back as soon as you start the pan.
    //
    // This is used only when drawerType is "front"
    const touchDistance =
      drawerType === 'front'
        ? minmax(
            drawerPosition === 'left'
              ? touchStartX.value - drawerWidth
              : layout.width - drawerWidth - touchStartX.value,
            0,
            layout.width
          )
        : 0;

    const translateX =
      drawerPosition === 'left'
        ? minmax(translationX.value + touchDistance, -drawerWidth, 0)
        : minmax(translationX.value - touchDistance, 0, drawerWidth);

    return translateX;
  });

  const drawerAnimatedStyle = useAnimatedStyle(() => {
    const distanceFromEdge = layout.width - drawerWidth;

    return {
      transform:
        drawerType === 'permanent'
          ? // Reanimated needs the property to be present, but it results in Browser bug
            // https://bugs.chromium.org/p/chromium/issues/detail?id=20574
            []
          : [
              {
                translateX:
                  // The drawer stays in place when `drawerType` is `back`
                  (drawerType === 'back' ? 0 : translateX.value) +
                  (drawerPosition === 'left' ? 0 : distanceFromEdge),
              },
            ],
    };
  });

  const contentAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform:
        drawerType === 'permanent'
          ? // Reanimated needs the property to be present, but it results in Browser bug
            // https://bugs.chromium.org/p/chromium/issues/detail?id=20574
            []
          : [
              {
                translateX:
                  // The screen content stays in place when `drawerType` is `front`
                  drawerType === 'front'
                    ? 0
                    : translateX.value +
                      drawerWidth * (drawerPosition === 'left' ? 1 : -1),
              },
            ],
    };
  });

  const progress = useDerivedValue(() => {
    return drawerType === 'permanent'
      ? 1
      : interpolate(
          translateX.value,
          [getDrawerTranslationX(false), getDrawerTranslationX(true)],
          [0, 1]
        );
  });

  return (
    <View style={[styles.container, style]}>
      <DrawerProgressContext.Provider value={progress}>
        {/* Immediate child of gesture handler needs to be an Animated.View */}
        <Animated.View
          style={[
            styles.main,
            {
              flexDirection:
                drawerType === 'permanent' && !isRight ? 'row-reverse' : 'row',
            },
          ]}
        >
          <Animated.View style={[styles.content, contentAnimatedStyle]}>
            <View
              accessibilityElementsHidden={isOpen && drawerType !== 'permanent'}
              importantForAccessibility={
                isOpen && drawerType !== 'permanent'
                  ? 'no-hide-descendants'
                  : 'auto'
              }
              style={styles.content}
            >
              {children}
            </View>
            {drawerType !== 'permanent' ? (
              <Overlay
                open={open}
                progress={progress}
                onPress={() => toggleDrawer(false)}
                style={overlayStyle}
                accessibilityLabel={overlayAccessibilityLabel}
              />
            ) : null}
          </Animated.View>
          <Animated.View
            removeClippedSubviews={Platform.OS !== 'ios'}
            style={[
              styles.drawer,
              {
                width: drawerWidth,
                position: drawerType === 'permanent' ? 'relative' : 'absolute',
                zIndex: drawerType === 'back' ? -1 : 0,
              },
              drawerAnimatedStyle,
              drawerStyle,
            ]}
          >
            {renderDrawerContent()}
          </Animated.View>
        </Animated.View>
      </DrawerProgressContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  drawer: {
    top: 0,
    bottom: 0,
    maxWidth: '100%',
    backgroundColor: 'white',
  },
  content: {
    flex: 1,
  },
  main: {
    flex: 1,
    ...Platform.select({
      // FIXME: We need to hide `overflowX` on Web so the translated content doesn't show offscreen.
      // But adding `overflowX: 'hidden'` prevents content from collapsing the URL bar.
      web: null,
      default: { overflow: 'hidden' },
    }),
  },
});
