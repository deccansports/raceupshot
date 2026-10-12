import Svg, { Circle, Path, Polyline, Rect } from "react-native-svg";

import { useTheme, type SemanticColors } from "@/core/theme";

export type IconName =
  | "chevronRight"
  | "chevronLeft"
  | "arrowRight"
  | "calendar"
  | "location"
  | "clock"
  | "trophy"
  | "medal"
  | "bell"
  | "share"
  | "search"
  | "home"
  | "heart"
  | "heartFilled"
  | "handshake"
  | "user"
  | "settings"
  | "filter"
  | "map"
  | "flag"
  | "layers"
  | "barChart"
  | "plus"
  | "minus"
  | "maximize"
  | "bookOpen"
  | "chevronDown"
  | "eye"
  | "eyeOff"
  | "swim"
  | "bike"
  | "run"
  | "transition"
  | "mountain"
  | "gauge";

export type IconProps = {
  name: IconName;
  size?: number;
  color?: keyof SemanticColors;
  /** Raw color override (e.g. from a navigator's tabBarIcon tint). */
  colorValue?: string;
};

/**
 * BERGMAN icon set. Consistent 24x24 grid, 2px stroke, rounded caps/joins for a
 * clean, confident feel. All icons are decorative by default; wrap in a
 * labelled pressable when interactive.
 */
export function Icon({
  name,
  size = 22,
  color = "textPrimary",
  colorValue,
}: IconProps) {
  const theme = useTheme();
  const stroke = colorValue ?? theme.colors[color];
  const common = {
    stroke,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none" as const,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === "chevronRight" && (
        <Polyline points="9 6 15 12 9 18" {...common} />
      )}
      {name === "chevronLeft" && (
        <Polyline points="15 6 9 12 15 18" {...common} />
      )}
      {name === "arrowRight" && (
        <>
          <Path d="M4 12 H20" {...common} />
          <Polyline points="14 6 20 12 14 18" {...common} />
        </>
      )}
      {name === "calendar" && (
        <>
          <Rect x={3} y={5} width={18} height={16} rx={3} {...common} />
          <Path d="M3 9 H21 M8 3 V7 M16 3 V7" {...common} />
        </>
      )}
      {name === "location" && (
        <>
          <Path
            d="M12 21c4-4.5 7-7.8 7-11a7 7 0 1 0-14 0c0 3.2 3 6.5 7 11Z"
            {...common}
          />
          <Circle cx={12} cy={10} r={2.5} {...common} />
        </>
      )}
      {name === "clock" && (
        <>
          <Circle cx={12} cy={12} r={8.5} {...common} />
          <Polyline points="12 7 12 12 15.5 14" {...common} />
        </>
      )}
      {name === "trophy" && (
        <>
          <Path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" {...common} />
          <Path
            d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M9 20h6M12 13v3"
            {...common}
          />
        </>
      )}
      {name === "medal" && (
        <>
          <Circle cx={12} cy={14} r={6} {...common} />
          <Path
            d="M8.5 8 6 3M15.5 8 18 3M12 11.5l1 2 2 .3-1.5 1.4.4 2-1.9-1-1.9 1 .4-2L9 13.8l2-.3 1-2Z"
            {...common}
          />
        </>
      )}
      {name === "bell" && (
        <>
          <Path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" {...common} />
          <Path d="M10 20a2 2 0 0 0 4 0" {...common} />
        </>
      )}
      {name === "share" && (
        <>
          <Circle cx={7} cy={12} r={2.5} {...common} />
          <Circle cx={17} cy={6} r={2.5} {...common} />
          <Circle cx={17} cy={18} r={2.5} {...common} />
          <Path d="M9.2 10.8 14.8 7.2M9.2 13.2l5.6 3.6" {...common} />
        </>
      )}
      {name === "search" && (
        <>
          <Circle cx={11} cy={11} r={7} {...common} />
          <Path d="M16.5 16.5 21 21" {...common} />
        </>
      )}
      {name === "home" && (
        <Path d="M4 11 12 4l8 7M6 9.5V20h12V9.5" {...common} />
      )}
      {name === "heart" && (
        <Path
          d="M12 20s-7-4.3-9.3-8.4C1.3 8.9 2.7 5.5 6 5.5c2 0 3.2 1.2 4 2.3.8-1.1 2-2.3 4-2.3 3.3 0 4.7 3.4 3.3 6.1C19 15.7 12 20 12 20Z"
          {...common}
        />
      )}
      {name === "heartFilled" && (
        <Path
          d="M12 20s-7-4.3-9.3-8.4C1.3 8.9 2.7 5.5 6 5.5c2 0 3.2 1.2 4 2.3.8-1.1 2-2.3 4-2.3 3.3 0 4.7 3.4 3.3 6.1C19 15.7 12 20 12 20Z"
          fill={stroke}
          stroke={stroke}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      )}
      {name === "handshake" && (
        <>
          <Path d="m2.5 8 4.3-4.3 4.2 4.2-4.3 4.3L2.5 8Z" {...common} />
          <Path d="m17.2 3.7 4.3 4.3-4.2 4.2-4.3-4.3 4.2-4.2Z" {...common} />
          <Path d="m6.7 12.2 2-2a2.2 2.2 0 0 1 3.1 0l.7.7 1.7-1.7" {...common} />
          <Path d="m8.1 15.7 3.2 3.2a1.55 1.55 0 0 0 2.2-2.2" {...common} />
          <Path d="m10.3 13.6 4.3 4.3a1.55 1.55 0 0 0 2.2-2.2" {...common} />
          <Path d="m13.4 12.5 3.4 3.4a1.55 1.55 0 0 0 2.2-2.2l-3.3-3.3" {...common} />
          <Path d="m6.7 12.2-1.3 1.3 4.4 4.4a1.55 1.55 0 0 0 2.2-2.2" {...common} />
        </>
      )}
      {name === "user" && (
        <>
          <Circle cx={12} cy={8} r={4} {...common} />
          <Path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" {...common} />
        </>
      )}
      {name === "settings" && (
        <>
          <Circle cx={12} cy={12} r={3} {...common} />
          <Path
            d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.05.05a2 2 0 0 1-1.42 3.42h-.07a1.7 1.7 0 0 0-1.7 1.17l-.02.06a2 2 0 0 1-3.82 0l-.02-.06A1.7 1.7 0 0 0 11 20.35h-.07a2 2 0 0 1-1.42-3.42l.05-.05A1.7 1.7 0 0 0 9.9 15a1.7 1.7 0 0 0-1.34-1.12l-.06-.01a2 2 0 0 1-1.59-2.91l.03-.06a1.7 1.7 0 0 0-.15-1.88l-.04-.05a2 2 0 0 1 1.42-3.42h.07A1.7 1.7 0 0 0 9.9 4.4l.02-.06a2 2 0 0 1 3.82 0l.02.06A1.7 1.7 0 0 0 15 5.65h.07a2 2 0 0 1 1.42 3.42l-.05.05A1.7 1.7 0 0 0 16.1 11a1.7 1.7 0 0 0 1.34 1.12l.06.01a2 2 0 0 1 1.59 2.91l-.03.06a1.7 1.7 0 0 0 .15 1.88l.04.05Z"
            {...common}
          />
        </>
      )}
      {name === "filter" && <Path d="M3 5h18M6 12h12M10 19h4" {...common} />}
      {name === "map" && (
        <>
          <Path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" {...common} />
          <Path d="M9 4v14M15 6v14" {...common} />
        </>
      )}
      {name === "flag" && (
        <>
          <Path d="M5 21V4" {...common} />
          <Path d="M5 4h12l-2 4 2 4H5" {...common} />
        </>
      )}
      {name === "layers" && (
        <>
          <Path d="M12 3 3.5 7.5 12 12l8.5-4.5L12 3Z" {...common} />
          <Path d="M3.5 12 12 16.5 20.5 12" {...common} />
          <Path d="M3.5 16.5 12 21l8.5-4.5" {...common} />
        </>
      )}
      {name === "barChart" && (
        <>
          <Path d="M4 20V10M10 20V5M16 20v-8M22 20H2" {...common} />
        </>
      )}
      {name === "plus" && <Path d="M12 5v14M5 12h14" {...common} />}
      {name === "minus" && <Path d="M5 12h14" {...common} />}
      {name === "maximize" && (
        <>
          <Path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" {...common} />
        </>
      )}
      {name === "bookOpen" && (
        <>
          <Path
            d="M12 6.5c-1.7-1.2-3.8-1.8-7-1.8v13.5c3.2 0 5.3.6 7 1.8V6.5Z"
            {...common}
          />
          <Path
            d="M12 6.5c1.7-1.2 3.8-1.8 7-1.8v13.5c-3.2 0-5.3.6-7 1.8V6.5Z"
            {...common}
          />
          <Path d="M12 6.5v13.5" {...common} />
        </>
      )}
      {name === "chevronDown" && (
        <Polyline points="6 9 12 15 18 9" {...common} />
      )}
      {name === "eye" && (
        <>
          <Path
            d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"
            {...common}
          />
          <Circle cx={12} cy={12} r={2.5} {...common} />
        </>
      )}
      {name === "eyeOff" && (
        <>
          <Path d="M4 4l16 16" {...common} />
          <Path
            d="M10.6 10.6A3 3 0 0 0 12 16c2.2 0 4-1.8 4-4 0-.5-.1-.9-.3-1.3"
            {...common}
          />
          <Path
            d="M6.2 7.2C3.9 8.9 2 12 2 12s3.5 6 10 6c1.4 0 2.7-.2 3.8-.6"
            {...common}
          />
          <Path
            d="M9.9 4.7C10.6 4.6 11.3 4.5 12 4.5c6.5 0 10 7.5 10 7.5s-1 1.7-2.9 3.5"
            {...common}
          />
        </>
      )}
      {name === "swim" && (
        <>
          <Circle cx={8} cy={8} r={2} {...common} />
          <Path
            d="M10 10l3 2 2-1.5M10 10l-1.8 3.2M9.2 13.2l3.8 1.8M3 17c1.2-1 2.4-1 3.6 0s2.4 1 3.6 0 2.4-1 3.6 0 2.4 1 3.6 0 2.4-1 3.6 0"
            {...common}
          />
        </>
      )}
      {name === "bike" && (
        <>
          <Circle cx={6.5} cy={16} r={3.5} {...common} />
          <Circle cx={17.5} cy={16} r={3.5} {...common} />
          <Path
            d="M8 8h3l2 4m0 0h3l2-4M10 8l-3.5 8M13 12l-2.5 4M12 6h2"
            {...common}
          />
        </>
      )}
      {name === "run" && (
        <>
          <Circle cx={14} cy={5.5} r={2} {...common} />
          <Path
            d="M12.5 8.5l-2 3 2.5 2 1.2 3.5M10.5 11.5L7 13l-2 3M12.5 8.5l3 2 2.5-.5"
            {...common}
          />
        </>
      )}
      {name === "transition" && (
        <>
          <Path d="M5 8h9M10 5l4 3-4 3M19 16H10M14 13l-4 3 4 3" {...common} />
        </>
      )}
      {name === "mountain" && (
        <>
          <Path d="M3 20 10 7l3 5 2-3 6 11H3Z" {...common} />
          <Path d="m8.5 10 1.5 2 1.2-1.5" {...common} />
        </>
      )}
      {name === "gauge" && (
        <>
          <Path d="M4 18a8 8 0 1 1 16 0" {...common} />
          <Path d="m12 15 4-5" {...common} />
          <Circle cx={12} cy={15} r={1.5} {...common} />
          <Path
            d="M6.5 14H5M19 14h-1.5M8 10 7 9M16 10l1-1M12 8V6.5"
            {...common}
          />
        </>
      )}
    </Svg>
  );
}
