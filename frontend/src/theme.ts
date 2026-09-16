import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    primary: {
      main: '#215743',
      light: '#E8F1E9',
      dark: '#153D30',
      contrastText: '#FFFFFF'
    },
    secondary: { main: '#AB5636', light: '#FAEBDD' },
    background: { default: '#F7F8F3', paper: '#FFFFFF' },
    text: { primary: '#263D33', secondary: '#69786F' },
    divider: '#E6EBE3',
    error: { main: '#B74439' },
    success: { main: '#357453' }
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    h1: {
      fontSize: '2.2rem',
      fontWeight: 750,
      letterSpacing: '-0.055em',
      lineHeight: 1.3
    },
    h2: {
      fontSize: '1.65rem',
      fontWeight: 750,
      letterSpacing: '-0.035em',
      lineHeight: 1.4
    },
    h3: { fontSize: '1.125rem', fontWeight: 700, lineHeight: 1.5 },
    h4: { fontSize: '1rem', fontWeight: 700 },
    body1: { fontSize: '0.9375rem', lineHeight: 1.75 },
    body2: { fontSize: '0.8125rem', lineHeight: 1.7 },
    button: { textTransform: 'none', fontWeight: 650, letterSpacing: 0 },
    overline: {
      fontSize: '0.65rem',
      letterSpacing: '0.16em',
      fontWeight: 700,
      lineHeight: 1.8
    }
  },
  components: {
    MuiStack: { defaultProps: { useFlexGap: true } },
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          overscrollBehavior: 'none',
          WebkitTapHighlightColor: 'transparent',
          overflow: 'hidden'
        },
        'button, a': { touchAction: 'manipulation' },
        'button:focus-visible, a:focus-visible, summary:focus-visible': {
          outline: '3px solid #B8CCAB',
          outlineOffset: 3
        },
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            transitionDuration: '0.01ms !important',
            scrollBehavior: 'auto !important'
          }
        }
      }
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 14, minHeight: 46, padding: '10px 20px' },
        outlined: { borderColor: '#D6E2D8' }
      }
    },
    MuiIconButton: {
      styleOverrides: { root: { minWidth: 44, minHeight: 44 } }
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: 'none' },
        rounded: { borderRadius: 22 }
      }
    },
    MuiTextField: { defaultProps: { fullWidth: true, variant: 'outlined' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { background: '#FAFBF8', borderRadius: 14 },
        input: { fontSize: 16, padding: '15px 16px' },
        notchedOutline: { borderColor: '#DDE5DC' }
      }
    },
    MuiInputLabel: { styleOverrides: { root: { fontSize: 15 } } },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 600, borderRadius: 10 } }
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 24 },
        paperFullScreen: {
          maxWidth: 640,
          margin: '0 auto',
          height: 'var(--app-height, 100dvh)',
          borderRadius: 0,
          background: '#F7F8F3'
        }
      }
    },
    MuiAlert: { styleOverrides: { root: { borderRadius: 14 } } },
    MuiToggleButton: {
      styleOverrides: {
        root: { textTransform: 'none', minHeight: 44, borderRadius: 12 }
      }
    },
    MuiSkeleton: {
      defaultProps: { animation: 'wave', variant: 'rounded' },
      styleOverrides: { root: { borderRadius: 18, backgroundColor: '#E8EDE5' } }
    }
  }
})
