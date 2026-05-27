// ignore_for_file: deprecated_member_use, use_build_context_synchronously, empty_catches, dead_code, dead_null_aware_expression

import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart' show compute, kDebugMode, kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:marquee/marquee.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:video_player/video_player.dart';
import 'package:youtube_player_flutter/youtube_player_flutter.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);
  runApp(const SignageApp());
}

Map<String, dynamic> _decodeJsonMap(String source) {
  final decoded = jsonDecode(source);
  return decoded as Map<String, dynamic>;
}

class SignageApp extends StatelessWidget {
  const SignageApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'RP Signage',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        primarySwatch: Colors.blue,
        fontFamily: 'Roboto',
      ),
      home: const SignagePlayer(),
    );
  }
}

class SignagePlayer extends StatefulWidget {
  const SignagePlayer({super.key});

  @override
  State<SignagePlayer> createState() => _SignagePlayerState();
}

class _SignagePlayerState extends State<SignagePlayer> with WidgetsBindingObserver {
  static const MethodChannel _kioskChannel = MethodChannel('rpsignage/kiosk');
  static const Map<String, Color> _themeColors = {
    'white': Colors.white,
    'cyan': Colors.cyanAccent,
    'yellow': Colors.amberAccent,
    'green': Colors.lightGreenAccent,
    'orange': Colors.orangeAccent,
    'red': Colors.redAccent,
    'blue': Colors.lightBlueAccent,
    'pink': Colors.pinkAccent,
  };

  bool showSplash = true;
  bool showPairing = false;
  String? currentPairCode;
  String pairingError = '';
  String? generatedPairCode;
  Map<String, dynamic>? payload;
  Map<String, dynamic>? providerData;
  Map<String, dynamic>? liveWeather;
  String weatherState = 'idle';
  String errorMessage = '';
  List<String> hiddenZoneIds = [];
  bool fillBlankSpaces = true;
  bool customPlacementEnabled = false;
  Map<String, String> zonePlacements = {};
  Map<String, String> zoneMediaModes = {};
  String orientationOverride = 'auto';
  double? brightnessOverridePercent;
  double weatherClockScale = 1.0;
  String weatherClockTextColorKey = 'white';
  double tickerSpeed = 50.0;
  String tickerTextColorKey = 'white';
  String tickerBackgroundColorKey = 'black';
  bool menuOpen = false;
  bool menuButtonVisible = false;
  bool kioskModeEnabled = true;
  bool kioskProvisionWarningShown = false;
  Timer? pollTimer;
  Timer? providerTimer;
  Timer? weatherTimer;
  Timer? menuButtonHideTimer;
  String apiBase = const String.fromEnvironment(
    'BACKEND_URL',
    defaultValue: 'https://rpsignage.com',
  );
  Size viewportSize = Size.zero;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _updateViewportSize();
    _loadPreferences();
    _applyAndroidKioskMode();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    pollTimer?.cancel();
    providerTimer?.cancel();
    weatherTimer?.cancel();
    menuButtonHideTimer?.cancel();
    super.dispose();
  }

  void _updateViewportSize() {
    if (!mounted) return;
    final view = WidgetsBinding.instance.platformDispatcher.implicitView;
    if (view != null) {
      final size = view.physicalSize / view.devicePixelRatio;
      setState(() {
        viewportSize = size;
      });
    }
  }

  void _safeSetState(VoidCallback fn) {
    if (!mounted) return;
    setState(fn);
  }

  void _logDebug(String message) {
    if (kDebugMode) {
      debugPrint('[SignagePlayer] $message');
    }
  }

  @override
  void didChangeMetrics() {
    _updateViewportSize();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _applyAndroidKioskMode();
      if (currentPairCode != null && !showPairing && !showSplash) {
        _poll();
      }
    }
  }

  Future<void> _applyAndroidKioskMode() async {
    if (!mounted) return;
    if (kIsWeb) return;

    try {
      final response = await _kioskChannel.invokeMethod('setKioskMode', {
        'enabled': kioskModeEnabled,
      });

      if (!mounted || response is! Map) return;

      final strictReady = response['strictReady'] == true;
      if (kioskModeEnabled && !strictReady && !kioskProvisionWarningShown) {
        kioskProvisionWarningShown = true;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Strict kiosk requires Device Owner provisioning via adb dpm.'),
            duration: Duration(seconds: 4),
          ),
        );
      }

      if (!kioskModeEnabled) {
        kioskProvisionWarningShown = false;
      }
    } catch (_) {
      // Best-effort call; some Android builds/devices may not support lock task.
    }
  }

  Future<void> _loadPreferences() async {
    final prefs = await SharedPreferences.getInstance();
    final savedPairCode = prefs.getString('pairCode');

    if (savedPairCode != null) {
      _safeSetState(() {
        currentPairCode = savedPairCode;
        showSplash = true;
      });
      await Future.delayed(const Duration(seconds: 2));
      if (mounted) {
        _safeSetState(() => showSplash = false);
        _poll();
      }
    } else {
      await Future.delayed(const Duration(seconds: 2));
      if (mounted) {
        _safeSetState(() {
          showSplash = false;
        });
      }
      // No saved pair code: automatically request a pairing code (device-generated)
      unawaited(_requestPairCodeAndWait());
    }
  }

  Future<String> _getOrCreateFingerprint() async {
    final prefs = await SharedPreferences.getInstance();
    final key = 'device_fingerprint';
    var fp = prefs.getString(key);
    if (fp != null && fp.isNotEmpty) return fp;
    final newFp = 'dev-${DateTime.now().millisecondsSinceEpoch}-${Random().nextInt(1 << 31)}';
    await prefs.setString(key, newFp);
    return newFp;
  }

  Future<void> _requestPairCodeAndWait() async {
    try {
      final fp = await _getOrCreateFingerprint();
      final body = json.encode({"device_fingerprint": fp, "device_name": "RP Signage Player"});
      final resp = await http
          .post(_apiUri('/api/public/pair/request'), headers: {'Content-Type': 'application/json'}, body: body)
          .timeout(const Duration(seconds: 10));
      if (resp.statusCode == 200) {
        final data = await compute(_decodeJsonMap, resp.body);
        final code = data['pair_code']?.toString();
        if (code == null || code.isEmpty) throw Exception('No pair code');
        generatedPairCode = code;
        _logDebug('received pair code: $code');
        _safeSetState(() {
          showPairing = true;
          pairingError = '';
        });

        // Poll pairing status until client binds the code
        for (;;) {
          await Future.delayed(const Duration(seconds: 4));
          try {
            final statusResp = await http
                .get(_apiUri('/api/public/pair/status/$code'))
                .timeout(const Duration(seconds: 8));
            if (statusResp.statusCode == 200) {
              final s = await compute(_decodeJsonMap, statusResp.body);
                _logDebug('pair status: ${s.toString()}');
              if (s['used'] == true && (s['paired_device_id'] ?? '').toString().isNotEmpty) {
                // Paired by the client panel — persist pair code and begin normal polling
                final prefs = await SharedPreferences.getInstance();
                await prefs.setString('pairCode', code);
                _safeSetState(() {
                  currentPairCode = code;
                  showPairing = false;
                  generatedPairCode = null;
                });
                _poll();
                return;
              }
            }
          } catch (e) {
            // ignore transient errors
          }
        }
      } else {
        _safeSetState(() {
          pairingError = 'Could not request pairing code';
          showPairing = true;
        });
      }
    } catch (e) {
      _safeSetState(() {
        pairingError = 'Pair request failed: ${e.toString()}';
        showPairing = true;
      });
    }
  }

  Future<void> _pairDevice(String code) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('pairCode', code);

    _safeSetState(() {
      currentPairCode = code;
      showPairing = false;
      pairingError = "";
    });

    _poll();
  }

  String _normalizedApiBase() {
    final trimmed = apiBase.trim();
    final fallback = trimmed.isEmpty ? 'https://rpsignage.com' : trimmed;
    final withoutSlash = fallback.replaceAll(RegExp(r'/$'), '');
    return withoutSlash.replaceAll(RegExp(r'/api$'), '');
  }

  Uri _apiUri(String path) {
    return Uri.parse('${_normalizedApiBase()}$path');
  }

  Future<void> _poll() async {
    if (currentPairCode == null) return;

    _logDebug('poll start pairCode=$currentPairCode apiBase=${_normalizedApiBase()}');

    try {
        final fp = await _getOrCreateFingerprint();
        final response = await http
          .get(_apiUri('/api/public/player/$currentPairCode'), headers: {'X-Device-Fingerprint': fp})
          .timeout(const Duration(seconds: 12));

      _logDebug('poll response status=${response.statusCode} bytes=${response.bodyBytes.length}');

      if (response.statusCode == 200) {
        final data = await compute(_decodeJsonMap, response.body);
        final zones = data['zones'];
        final template = data['template'];
        _logDebug('poll success device=${data['device_name']} zoneKeys=${zones is Map ? zones.keys.join(',') : 'n/a'} template=${template is Map ? 'present' : 'missing'}');
        _safeSetState(() {
          payload = data;
          errorMessage = "";
          pairingError = "";
        });

        await _loadZonePreferences();

        final clientId = data['client_id']?.toString();
        if (clientId != null && clientId.isNotEmpty) {
          _logDebug('poll -> fetching provider data for clientId=$clientId');
          unawaited(_fetchProviderData(clientId));
        }

        _checkWeatherZones();
      } else if (response.statusCode == 404) {
        _logDebug('poll 404: pair code not found on ${_normalizedApiBase()}');
        _safeSetState(() {
          pairingError = "Invalid pairing code. Please check and try again.";
          showPairing = true;
          currentPairCode = null;
        });
        final prefs = await SharedPreferences.getInstance();
        await prefs.remove('pairCode');
      } else {
        _logDebug('poll unexpected status ${response.statusCode}: ${response.body}');
        _safeSetState(() => errorMessage = "Could not load content");
      }
    } catch (e) {
      _logDebug('poll exception: $e');
      _safeSetState(() => errorMessage = "Connection error: ${e.toString()}");
    }

    pollTimer?.cancel();
    pollTimer = Timer.periodic(const Duration(seconds: 60), (_) {
      if (currentPairCode != null && !showPairing && !showSplash) {
        _poll();
      }
    });
  }

  Future<void> _fetchProviderData(String clientId) async {
    _logDebug('provider fetch start clientId=$clientId apiBase=${_normalizedApiBase()}');

    try {
      final response = await http
          .get(_apiUri('/api/public/providers/$clientId'))
          .timeout(const Duration(seconds: 12));
      if (response.statusCode == 200) {
        _logDebug('provider fetch success bytes=${response.bodyBytes.length}');
        final parsedProvider = await compute(_decodeJsonMap, response.body);
        _safeSetState(() => providerData = parsedProvider);
      } else {
        _logDebug('provider fetch status=${response.statusCode}');
      }
    } catch (e) {
      _logDebug('provider fetch failed: $e');
    }

    providerTimer?.cancel();
    providerTimer = Timer.periodic(const Duration(seconds: 20), (_) async {
      if (currentPairCode != null && !showPairing && !showSplash) {
        try {
          final response = await http
              .get(_apiUri('/api/public/providers/$clientId'))
              .timeout(const Duration(seconds: 12));
          if (response.statusCode == 200 && mounted) {
            final parsedProvider = await compute(_decodeJsonMap, response.body);
            setState(() => providerData = parsedProvider);
          }
        } catch (e) {
          _logDebug('provider refresh failed: $e');
        }
      }
    });
  }

  Future<void> _checkWeatherZones() async {
    if (payload == null) return;

    final zones = _getZoneDefinitions();
    final hasWeatherZone = zones.any((z) {
      final id = (z['id'] ?? '').toString().toLowerCase();
      final name = (z['name'] ?? '').toString().toLowerCase();
      final role = (z['role'] ?? '').toString().toLowerCase();
      return id.contains('weather') || name.contains('weather') || role.contains('weather');
    });

    if (hasWeatherZone && liveWeather == null &&
        payload?['weather'] == null && providerData?['weather'] == null) {
      await _fetchWeather();
    }
  }

  Future<void> _fetchWeather() async {
    if (weatherState == "denied" || weatherState == "error") return;

    _safeSetState(() => weatherState = "requesting");

    try {
      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied) {
          _safeSetState(() => weatherState = "denied");
          return;
        }
      }

      if (permission == LocationPermission.deniedForever) {
        _safeSetState(() => weatherState = "denied");
        return;
      }

      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.low,
      ).timeout(const Duration(seconds: 8));

      final response = await http.get(Uri.parse(
          'https://api.open-meteo.com/v1/forecast?'
              'latitude=${position.latitude}&longitude=${position.longitude}'
              '&current=temperature_2m,weather_code,relative_humidity_2m'
              '&daily=temperature_2m_max,temperature_2m_min&timezone=auto'
      ));

      if (response.statusCode == 200) {
        final data = await compute(_decodeJsonMap, response.body);
        final current = data['current'] ?? {};
        final daily = data['daily'] ?? {};

        _safeSetState(() {
          liveWeather = {
            'location': 'Current location',
            'temperature': current['temperature_2m'],
            'condition': 'Weather code ${current['weather_code']}',
            'high': daily['temperature_2m_max']?.first,
            'low': daily['temperature_2m_min']?.first,
            'humidity': current['relative_humidity_2m'],
            'weather_code': current['weather_code'],
          };
          weatherState = "ready";
        });
      }
    } catch (e) {
      _safeSetState(() => weatherState = "error");
    }
  }

  Future<void> _loadZonePreferences() async {
    if (currentPairCode == null) return;
    final prefs = await SharedPreferences.getInstance();
    final key = 'signage-player-zone-prefs:$currentPairCode';
    final raw = prefs.getString(key);

    if (raw != null) {
      try {
        final data = await compute(_decodeJsonMap, raw);
        _safeSetState(() {
          if (data['hiddenZoneIds'] is List) {
            hiddenZoneIds = List<String>.from(data['hiddenZoneIds']);
          }
          if (data['fillBlankSpaces'] is bool) {
            fillBlankSpaces = data['fillBlankSpaces'];
          }
          if (data['customPlacementEnabled'] is bool) {
            customPlacementEnabled = data['customPlacementEnabled'];
          }
          if (data['zonePlacements'] is Map) {
            zonePlacements = Map<String, String>.from(data['zonePlacements']);
          }
          if (data['zoneMediaModes'] is Map) {
            zoneMediaModes = Map<String, String>.from(data['zoneMediaModes']);
          }
          if (data['weatherClockScale'] is num) {
            weatherClockScale =
                (data['weatherClockScale'] as num).toDouble().clamp(0.7, 1.5);
          }
          if (data['weatherClockTextColorKey'] is String) {
            final key = data['weatherClockTextColorKey'] as String;
            if (_themeColors.containsKey(key)) {
              weatherClockTextColorKey = key;
            }
          }
          if (data['tickerSpeed'] is num) {
            tickerSpeed = (data['tickerSpeed'] as num).toDouble().clamp(20.0, 140.0);
          }
          if (data['tickerTextColorKey'] is String) {
            final key = data['tickerTextColorKey'] as String;
            if (_themeColors.containsKey(key)) {
              tickerTextColorKey = key;
            }
          }
          if (data['tickerBackgroundColorKey'] is String) {
            final key = data['tickerBackgroundColorKey'] as String;
            if (key == 'black' || key == 'navy' || key == 'transparent') {
              tickerBackgroundColorKey = key;
            }
          }
        });
      } catch (e) {}
    }

    final orientationKey = 'signage-player-orientation:$currentPairCode';
    final savedOrientation = prefs.getString(orientationKey);
    if (savedOrientation != null &&
        ['auto', 'landscape', 'portrait'].contains(savedOrientation)) {
      _safeSetState(() => orientationOverride = savedOrientation);
    }
  }

  Future<void> _saveZonePreferences() async {
    if (currentPairCode == null) return;
    final prefs = await SharedPreferences.getInstance();
    final key = 'signage-player-zone-prefs:$currentPairCode';

    await prefs.setString(key, json.encode({
      'hiddenZoneIds': hiddenZoneIds,
      'fillBlankSpaces': fillBlankSpaces,
      'customPlacementEnabled': customPlacementEnabled,
      'zonePlacements': zonePlacements,
      'zoneMediaModes': zoneMediaModes,
      'weatherClockScale': weatherClockScale,
      'weatherClockTextColorKey': weatherClockTextColorKey,
      'tickerSpeed': tickerSpeed,
      'tickerTextColorKey': tickerTextColorKey,
      'tickerBackgroundColorKey': tickerBackgroundColorKey,
    }));

    final orientationKey = 'signage-player-orientation:$currentPairCode';
    await prefs.setString(orientationKey, orientationOverride);
  }

  List<Map<String, dynamic>> _getZoneDefinitions() {
    final layout = payload?['template']?['layout'] ?? {};
    List<Map<String, dynamic>> zoneDefs = [];

    if (layout['zones'] != null && layout['zones'] is List) {
      zoneDefs = List<Map<String, dynamic>>.from(layout['zones']);
    } else {
      if (layout['main'] != null) {
        zoneDefs.add({'id': 'main', 'name': layout['main'].toString()});
      }
      if (layout['sidebar'] != null) {
        zoneDefs.add({'id': 'sidebar', 'name': layout['sidebar'].toString()});
      }
      if (layout['ticker'] != null) {
        zoneDefs.add({'id': 'ticker', 'name': layout['ticker'].toString()});
      }
      if (zoneDefs.isEmpty) {
        zoneDefs = [
          {'id': 'main', 'name': 'Main'},
          {'id': 'sidebar', 'name': 'Sidebar'},
          {'id': 'ticker', 'name': 'Ticker'},
        ];
      }
    }

    return zoneDefs;
  }

  void _goFullscreen() {
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Fullscreen mode activated'),
        duration: Duration(seconds: 1),
      ),
    );
  }

  void _toggleMenu() {
    final willOpen = !menuOpen;
    menuButtonHideTimer?.cancel();
    setState(() {
      menuOpen = willOpen;
      menuButtonVisible = true;
    });

    if (!willOpen) {
      _showMenuButton();
    }
  }

  void _showMenuButton() {
    menuButtonHideTimer?.cancel();
    if (!mounted) return;
    setState(() => menuButtonVisible = true);

    if (!menuOpen) {
      menuButtonHideTimer = Timer(const Duration(seconds: 3), () {
        if (!mounted || menuOpen) return;
        setState(() => menuButtonVisible = false);
      });
    }
  }

  KeyEventResult _handlePlayerKeyEvent(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent) return KeyEventResult.ignored;

    final isMenuKey = event.logicalKey == LogicalKeyboardKey.contextMenu;
    if (!isMenuKey) return KeyEventResult.ignored;

    _toggleMenu();
    return KeyEventResult.handled;
  }

  void _resetZones() {
    setState(() {
      hiddenZoneIds = [];
      fillBlankSpaces = true;
      customPlacementEnabled = false;
      zonePlacements = {};
      zoneMediaModes = {};
    });
    _saveZonePreferences();
  }

  void _setOrientation(String mode) {
    setState(() => orientationOverride = mode);

    if (mode == 'landscape') {
      SystemChrome.setPreferredOrientations([
        DeviceOrientation.landscapeLeft,
        DeviceOrientation.landscapeRight,
      ]);
    } else if (mode == 'portrait') {
      SystemChrome.setPreferredOrientations([
        DeviceOrientation.portraitUp,
        DeviceOrientation.portraitDown,
      ]);
    } else {
      SystemChrome.setPreferredOrientations([
        DeviceOrientation.landscapeLeft,
        DeviceOrientation.landscapeRight,
        DeviceOrientation.portraitUp,
        DeviceOrientation.portraitDown,
      ]);
    }

    _saveZonePreferences();
  }

  void _setFillBlankSpaces(bool value) {
    setState(() => fillBlankSpaces = value);
    _saveZonePreferences();
  }

  void _setCustomPlacementEnabled(bool value) {
    setState(() => customPlacementEnabled = value);
    _saveZonePreferences();
  }

  void _setZoneMediaMode(String zoneId, String mode) {
    setState(() {
      zoneMediaModes[zoneId] = mode;
    });
    _saveZonePreferences();
  }

  void _setZonePlacement(String zoneId, String placement) {
    setState(() {
      zonePlacements[zoneId] = placement;
    });
    _saveZonePreferences();
  }

  void _setBrightnessOverride(double value) {
    setState(() {
      brightnessOverridePercent = value.clamp(10.0, 100.0);
    });
  }

  void _setAutoBrightnessFromPayload() {
    setState(() {
      brightnessOverridePercent = null;
    });
  }

  Color _tickerBackgroundColorFromKey(String key) {
    switch (key) {
      case 'navy':
        return const Color(0xFF0B1220);
      case 'transparent':
        return Colors.transparent;
      default:
        return Colors.black;
    }
  }

  void _setWeatherClockScale(double value) {
    setState(() {
      weatherClockScale = value.clamp(0.7, 1.5);
    });
    _saveZonePreferences();
  }

  void _setWeatherClockTextColor(String key) {
    if (!_themeColors.containsKey(key)) return;
    setState(() {
      weatherClockTextColorKey = key;
    });
    _saveZonePreferences();
  }

  void _setTickerSpeed(double value) {
    setState(() {
      tickerSpeed = value.clamp(20.0, 140.0);
    });
    _saveZonePreferences();
  }

  void _setTickerTextColor(String key) {
    if (!_themeColors.containsKey(key)) return;
    setState(() {
      tickerTextColorKey = key;
    });
    _saveZonePreferences();
  }

  void _setTickerBackgroundColor(String key) {
    if (!(key == 'black' || key == 'navy' || key == 'transparent')) return;
    setState(() {
      tickerBackgroundColorKey = key;
    });
    _saveZonePreferences();
  }

  String _kioskExitKey() {
    final fromPayload = payload?['kiosk_exit_key']?.toString().trim() ?? '';
    if (fromPayload.isNotEmpty) return fromPayload;
    final fromPairCode = currentPairCode?.trim() ?? '';
    return fromPairCode;
  }

  Future<bool> _requestKioskAuthorization(String actionLabel, {bool alwaysPrompt = false}) async {
    if (!kioskModeEnabled && !alwaysPrompt) return true;

    final expectedKey = _kioskExitKey();
    if (expectedKey.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Exit key not configured. Re-pair device first.')),
        );
      }
      return false;
    }

    final controller = TextEditingController();
    bool granted = false;

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) {
        return AlertDialog(
          backgroundColor: const Color(0xFF0F172A),
          title: const Text(
            'Kiosk Locked',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Enter device key to $actionLabel.',
                style: TextStyle(color: Colors.white.withOpacity(0.85)),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: controller,
                autofocus: true,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  labelText: 'Device key',
                  labelStyle: TextStyle(color: Colors.white.withOpacity(0.65)),
                  enabledBorder: OutlineInputBorder(
                    borderSide: BorderSide(color: Colors.white.withOpacity(0.25)),
                  ),
                  focusedBorder: const OutlineInputBorder(
                    borderSide: BorderSide(color: Colors.cyanAccent),
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () {
                granted = controller.text.trim() == expectedKey;
                Navigator.of(ctx).pop();
              },
              child: const Text('Unlock'),
            ),
          ],
        );
      },
    );

    if (!granted && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Invalid key. Access denied.')),
      );
    }

    return granted;
  }

  Future<void> _attemptChangeDevice() async {
    final allowed = await _requestKioskAuthorization('change device');
    if (!allowed || !mounted) return;

    setState(() {
      showPairing = true;
      menuOpen = false;
      menuButtonVisible = false;
    });
    menuButtonHideTimer?.cancel();
  }

  Future<void> _attemptQuitApp() async {
    final allowed = await _requestKioskAuthorization('quit app');
    if (!allowed) return;
    kioskModeEnabled = false;
    await _applyAndroidKioskMode();
    await SystemNavigator.pop();
  }

  Future<void> _toggleKioskMode() async {
    final allowed = await _requestKioskAuthorization(
      kioskModeEnabled ? 'disable kiosk mode' : 'enable kiosk mode',
      alwaysPrompt: true,
    );
    if (!allowed || !mounted) return;

    setState(() {
      kioskModeEnabled = !kioskModeEnabled;
    });
    await _applyAndroidKioskMode();

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(kioskModeEnabled ? 'Kiosk mode enabled' : 'Kiosk mode disabled'),
        duration: const Duration(seconds: 1),
      ),
    );
  }

  Future<bool> _onWillPop() async {
    if (menuOpen) {
      setState(() {
        menuOpen = false;
      });
      _showMenuButton();
      return false;
    }

    if (!kioskModeEnabled) return true;
    final allowed = await _requestKioskAuthorization('exit app');
    if (allowed) {
      await SystemNavigator.pop();
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    _logDebug('build showSplash=$showSplash showPairing=$showPairing pairCode=$currentPairCode payload=${payload == null ? 'null' : 'ready'} error=${errorMessage.isNotEmpty ? errorMessage : 'none'}');

    if (showSplash) {
      return const ModernSplashScreen();
    }

    if (showPairing) {
      return PairingScreen(
        onPair: _pairDevice,
        error: pairingError,
        initialCode: generatedPairCode,
        onRequestCode: _requestPairCodeAndWait,
      );
    }

    if (errorMessage.isNotEmpty && payload == null) {
      return _buildErrorScreen();
    }

    if (payload == null) {
      _logDebug('build -> loading screen because payload is still null');
      return const Scaffold(
        backgroundColor: Colors.black,
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return _buildPlayerScreen();
  }

  Widget _buildErrorScreen() {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 48, color: Colors.white38),
            const SizedBox(height: 12),
            Text(
              'Pair code: ${currentPairCode ?? "N/A"}',
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 18,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              errorMessage,
              style: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w800,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () => setState(() {
                showPairing = true;
                errorMessage = "";
              }),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.white24,
                foregroundColor: Colors.white,
              ),
              child: const Text('Re-pair Device'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPlayerScreen() {
    final layout = payload?['template']?['layout'] ?? {};
    final canvasWidth = (layout['canvas_width'] ?? 1920).toDouble();
    final canvasHeight = (layout['canvas_height'] ?? 1080).toDouble();
    final payloadBrightness = (payload?['brightness'] ?? 100).toDouble().clamp(10.0, 100.0);
    final effectiveBrightnessPercent = brightnessOverridePercent ?? payloadBrightness;
    final brightness = effectiveBrightnessPercent / 100;

    final zoneDefs = _getZoneDefinitions();
    final visibleZones = zoneDefs
        .where((z) => !hiddenZoneIds.contains(z['id']))
        .toList();

    final hasContent = visibleZones.any((z) {
      final items = payload?['zones']?[z['id']] ?? [];
      return items.isNotEmpty;
    });

    _logDebug('player screen zones=${zoneDefs.length} visible=${visibleZones.length} hasContent=$hasContent hidden=${hiddenZoneIds.length} payloadZones=${(payload?['zones'] is Map) ? (payload?['zones'] as Map).length : 0}');

    final explicitRotation = _normalizeRotation(
        payload?['rotation'] ?? payload?['rotation_degrees'] ?? payload?['rotation_angle'] ?? payload?['rotate'] ?? 0
    );

    final baseRotation = 0;

    final rotationDeg = _normalizeRotation(baseRotation + explicitRotation);
    final isQuarterTurn = rotationDeg == 90 || rotationDeg == 270;
    final surfaceWidth = isQuarterTurn ? viewportSize.height : viewportSize.width;
    final surfaceHeight = isQuarterTurn ? viewportSize.width : viewportSize.height;

    final content = ColorFiltered(
      colorFilter: ColorFilter.mode(
        Colors.white.withOpacity(brightness),
        BlendMode.modulate,
      ),
      child: hasContent
          ? _buildContent(visibleZones, canvasWidth, canvasHeight, surfaceWidth, surfaceHeight)
          : _buildEmptyScreen(),
    );

    return WillPopScope(
      onWillPop: _onWillPop,
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Focus(
          autofocus: true,
          onKeyEvent: _handlePlayerKeyEvent,
          child: Listener(
            behavior: HitTestBehavior.opaque,
            onPointerDown: (_) => _showMenuButton(),
            child: Stack(
              fit: StackFit.expand,
              children: [
                Container(
                  color: Colors.black,
                ),
                ClipRect(
                  child: SizedBox(
                    width: surfaceWidth,
                    height: surfaceHeight,
                    child: _buildRotatedSurface(rotationDeg, surfaceWidth, surfaceHeight, content),
                  ),
                ),
                if (menuButtonVisible || menuOpen)
                  Positioned(
                    top: 16,
                    right: 16,
                    child: _buildMenuButton(zoneDefs),
                  ),
                if (menuOpen)
                  Positioned.fill(
                    child: _buildMenuOverlay(zoneDefs, payloadBrightness, effectiveBrightnessPercent),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  int _normalizeRotation(dynamic value) {
    final num = int.tryParse(value?.toString() ?? '0') ?? 0;
    final normalized = ((num.round() / 90).round() * 90) % 360;
    if (normalized < 0) return normalized + 360;
    return [0, 90, 180, 270].contains(normalized) ? normalized : 0;
  }

  Widget _buildRotatedSurface(int rotation, double surfaceWidth, double surfaceHeight, Widget child) {
    switch (rotation) {
      case 90:
        return Transform.rotate(
          angle: pi / 2,
          alignment: Alignment.topLeft,
          child: Transform.translate(
            offset: Offset(0, -surfaceHeight),
            child: child,
          ),
        );
      case 180:
        return Transform.rotate(
          angle: pi,
          alignment: Alignment.topLeft,
          child: Transform.translate(
            offset: Offset(-surfaceWidth, -surfaceHeight),
            child: child,
          ),
        );
      case 270:
        return Transform.rotate(
          angle: 3 * pi / 2,
          alignment: Alignment.topLeft,
          child: Transform.translate(
            offset: Offset(-surfaceWidth, 0),
            child: child,
          ),
        );
      default:
        return child;
    }
  }

  Widget _buildEmptyScreen() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text(
            'NO CONTENT SCHEDULED',
            style: TextStyle(
              fontSize: 12,
              letterSpacing: 2,
              color: Colors.white38,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            payload?['device_name'] ?? 'Digital Signage',
            style: const TextStyle(
              fontSize: 32,
              fontWeight: FontWeight.w800,
              color: Colors.white,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'Ask your client account to upload media,\nbuild a playlist, and schedule it for this device.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 14,
              color: Colors.white54,
            ),
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _attemptChangeDevice,
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.white24,
              foregroundColor: Colors.white,
            ),
            child: const Text('Change Device'),
          ),
        ],
      ),
    );
  }

  Widget _buildContent(
      List<Map<String, dynamic>> visibleZones,
      double canvasWidth,
      double canvasHeight,
      double viewportWidth,
      double viewportHeight,
      ) {
    final hasAbsoluteLayout = visibleZones.any((z) =>
    z['x'] != null || z['y'] != null ||
        z['width_px'] != null || z['height_px'] != null
    );

    final hasCustomPlacements = customPlacementEnabled && zonePlacements.isNotEmpty;
    final renderAsAbsolute = hasAbsoluteLayout || hasCustomPlacements;
    final shouldCompact = fillBlankSpaces && hiddenZoneIds.isNotEmpty && !hasCustomPlacements;

    _logDebug('build content absolute=$renderAsAbsolute compact=$shouldCompact canvas=${canvasWidth.toStringAsFixed(0)}x${canvasHeight.toStringAsFixed(0)} viewport=${viewportWidth.toStringAsFixed(0)}x${viewportHeight.toStringAsFixed(0)} zoneCount=${visibleZones.length}');

    if (renderAsAbsolute && !shouldCompact) {
      return SizedBox.expand(
        child: _buildAbsoluteLayout(
          visibleZones,
          canvasWidth,
          canvasHeight,
          viewportWidth,
          viewportHeight,
        ),
      );
    }

    return SizedBox.expand(
      child: _buildFlexLayout(visibleZones, canvasWidth, canvasHeight),
    );
  }

  Widget _buildAbsoluteLayout(
      List<Map<String, dynamic>> zones,
      double canvasWidth,
      double canvasHeight,
      double viewportWidth,
      double viewportHeight,
      ) {
    final effectiveViewportWidth = viewportWidth > 0 ? viewportWidth : canvasWidth;
    final effectiveViewportHeight = viewportHeight > 0 ? viewportHeight : canvasHeight;
    final scaleX = effectiveViewportWidth / canvasWidth;
    final scaleY = effectiveViewportHeight / canvasHeight;

    return Stack(
      fit: StackFit.expand,
      children: zones.map((zone) {
        final zoneId = zone['id']?.toString() ?? '';
        final items = List<Map<String, dynamic>>.from(
          payload?['zones']?[zoneId] ?? [],
        );

        final placement = zonePlacements[zoneId] ?? 'auto';
        final rect = _getAbsoluteZoneRect(zone, canvasWidth, canvasHeight, placement);

        return Positioned(
          left: rect['left']! * scaleX,
          top: rect['top']! * scaleY,
          width: rect['width']! * scaleX,
          height: rect['height']! * scaleY,
          child: ClipRect(
            child: _buildZone(zone, items, canvasWidth, canvasHeight),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildFlexLayout(
      List<Map<String, dynamic>> zones,
      double canvasWidth,
      double canvasHeight,
      ) {
    if (zones.isEmpty) {
      return const SizedBox();
    }

    if (zones.length == 1) {
      final zone = zones.first;
      final items = List<Map<String, dynamic>>.from(
        payload?['zones']?[zone['id']] ?? [],
      );
      return _buildZone(zone, items, canvasWidth, canvasHeight);
    }

    // Use Column with Expanded to prevent overflow
    return Column(
      mainAxisSize: MainAxisSize.max,
      children: zones.asMap().entries.map((entry) {
        final zone = entry.value;
        final items = List<Map<String, dynamic>>.from(
          payload?['zones']?[zone['id']] ?? [],
        );
        return Expanded(
          child: LayoutBuilder(
            builder: (context, constraints) {
              // Ensure the zone gets proper constraints
              return Container(
                constraints: BoxConstraints(
                  minHeight: 0,
                  maxHeight: constraints.maxHeight,
                ),
                child: ClipRect(
                  child: _buildZone(zone, items, canvasWidth, canvasHeight),
                ),
              );
            },
          ),
        );
      }).toList(),
    );
  }

  Map<String, double> _getAbsoluteZoneRect(
      Map<String, dynamic> zone,
      double canvasWidth,
      double canvasHeight,
      String placement,
      ) {
    final preset = _getPlacementRect(placement);
    if (preset != null) {
      return {
        'left': (preset['left']! / 100) * canvasWidth,
        'top': (preset['top']! / 100) * canvasHeight,
        'width': (preset['width']! / 100) * canvasWidth,
        'height': (preset['height']! / 100) * canvasHeight,
      };
    }

    final rawLeft = (zone['x'] ?? 0).toDouble();
    final rawTop = (zone['y'] ?? 0).toDouble();
    final rawWidth = (zone['width_px'] ?? canvasWidth).toDouble();
    final rawHeight = (zone['height_px'] ?? canvasHeight).toDouble();

    final clampedLeft = rawLeft.clamp(0.0, canvasWidth);
    final clampedTop = rawTop.clamp(0.0, canvasHeight);
    final clampedWidth = rawWidth.clamp(0.0, canvasWidth - clampedLeft);
    final clampedHeight = rawHeight.clamp(0.0, canvasHeight - clampedTop);

    return {
      'left': clampedLeft,
      'top': clampedTop,
      'width': clampedWidth,
      'height': clampedHeight,
    };
  }

  Map<String, double>? _getPlacementRect(String placement) {
    switch (placement) {
      case 'full':
        return {'left': 0, 'top': 0, 'width': 100, 'height': 100};
      case 'left':
        return {'left': 0, 'top': 0, 'width': 35, 'height': 100};
      case 'right':
        return {'left': 65, 'top': 0, 'width': 35, 'height': 100};
      case 'top':
        return {'left': 0, 'top': 0, 'width': 100, 'height': 35};
      case 'bottom':
        return {'left': 0, 'top': 65, 'width': 100, 'height': 35};
      case 'center':
        return {'left': 15, 'top': 15, 'width': 70, 'height': 70};
      default:
        return null;
    }
  }

  Widget _buildZone(
      Map<String, dynamic> zone,
      List<Map<String, dynamic>> items,
      double canvasWidth,
      double canvasHeight,
      ) {
    final zoneId = zone['id']?.toString() ?? '';
    final zoneName = zone['name']?.toString() ?? '';
    final zoneRole = zone['role']?.toString() ?? '';
    final queuePreview = _getQueuePreview();
    final notices = _getNotices();

    _logDebug('zone render id=$zoneId name=$zoneName role=$zoneRole items=${items.length} queuePreview=${queuePreview.length} notices=${notices.length}');

    if (_isQueueZone(zoneId, zoneName, zoneRole)) {
      _logDebug('zone branch=$zoneId -> queue board');
      return QueueBoard(
        deviceName: payload?['device_name']?.toString(),
        queuePreview: queuePreview,
        notices: notices,
      );
    }

    if (_isTickerZone(zoneId, zoneName)) {
      _logDebug('zone branch=$zoneId -> ticker');
      return TickerSlot(
        items: items,
        label: zoneName,
        tickerSpeed: tickerSpeed,
        textColor: _themeColors[tickerTextColorKey] ?? Colors.white,
        backgroundColor: _tickerBackgroundColorFromKey(tickerBackgroundColorKey),
      );
    }

    if (_isLogoZone(zoneId, zoneName, zoneRole) && items.isEmpty) {
      final logoUrl = _getClientLogoUrl();
      if (logoUrl != null) {
        _logDebug('zone branch=$zoneId -> logo url=$logoUrl');
        return Container(
          color: Colors.black,
          child: Center(
            child: Container(
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white10),
                borderRadius: BorderRadius.circular(24),
                color: Colors.white.withOpacity(0.05),
              ),
              padding: const EdgeInsets.all(16),
              child: CachedNetworkImage(
                imageUrl: logoUrl,
                fit: BoxFit.contain,
                placeholder: (context, url) => const CircularProgressIndicator(),
                errorWidget: (context, url, error) => const Icon(
                  Icons.image,
                  size: 48,
                  color: Colors.white24,
                ),
              ),
            ),
          ),
        );
      }
    }

    if (_isAutoWidgetZone(zoneRole) && items.isEmpty) {
      _logDebug('zone branch=$zoneId -> auto widget');
      return AutoWidgetZone(
        zone: zone,
        queuePreview: queuePreview,
        payload: payload,
        providerData: providerData,
        weatherData: liveWeather ?? payload?['weather'] ?? providerData?['weather'],
        canvasWidth: canvasWidth,
        canvasHeight: canvasHeight,
        weatherScaleFactor: weatherClockScale,
        weatherClockTextColor: _themeColors[weatherClockTextColorKey] ?? Colors.white,
      );
    }

    _logDebug('zone branch=$zoneId -> media slot mode=${zoneMediaModes[zoneId] ?? _getDefaultZoneMediaMode(zone)}');
    return MediaSlot(
      key: ValueKey('media-slot:$zoneId:${items.map((item) {
        final type = (item['type'] ?? item['kind'] ?? '').toString().toLowerCase();
        final mediaId = item['media_id']?.toString() ?? '';
        final url = (item['url'] ?? item['image_url'] ?? item['public_url'] ?? item['media_url'] ?? '').toString();
        final duration = (item['duration'] ?? '').toString();
        return '$type|$mediaId|$url|$duration';
      }).join('||')}'),
      items: items,
      label: zoneName,
      mediaMode: zoneMediaModes[zoneId] ?? _getDefaultZoneMediaMode(zone),
      queuePreview: queuePreview,
      todayBookingsPreview: (providerData?['today_bookings_preview'] as List<dynamic>?) ??
          (payload?['today_bookings_preview'] as List<dynamic>?) ??
          const [],
      liveQueue: (providerData?['live_queue'] as List<dynamic>?) ??
          (payload?['live_queue'] as List<dynamic>?) ??
          const [],
      notices: notices,
      weatherClockScale: weatherClockScale,
      weatherClockTextColor: _themeColors[weatherClockTextColorKey] ?? Colors.white,
    );
  }

  bool _isQueueZone(String id, String name, String role) {
    final idLower = id.toLowerCase();
    final nameLower = name.toLowerCase();
    final roleLower = role.toLowerCase();
    return idLower.contains('queue') || idLower.contains('token') ||
        nameLower.contains('queue') || nameLower.contains('token') ||
        roleLower == 'queue';
  }

  bool _isTickerZone(String id, String name) {
    final idLower = id.toLowerCase();
    final nameLower = name.toLowerCase();
    return idLower.contains('ticker') || nameLower.contains('ticker');
  }

  bool _isLogoZone(String id, String name, String role) {
    final idLower = id.toLowerCase();
    final nameLower = name.toLowerCase();
    final roleLower = role.toLowerCase();
    return idLower.contains('logo') || idLower.contains('brand') ||
        nameLower.contains('logo') || nameLower.contains('brand') ||
        roleLower == 'logo';
  }

  bool _isAutoWidgetZone(String role) {
    return ['header', 'weather', 'bookings'].contains(role.toLowerCase());
  }

  List<dynamic> _getQueuePreview() {
    final providerPreview = providerData?['queue_preview'];
    if (providerPreview is List && providerPreview.isNotEmpty) {
      return providerPreview;
    }

    final payloadPreview = payload?['queue_preview'];
    if (payloadPreview is List && payloadPreview.isNotEmpty) {
      return payloadPreview;
    }

    return const [];
  }

  List<dynamic> _getNotices() {
    final providerNotices = providerData?['notices'];
    if (providerNotices is List && providerNotices.isNotEmpty) {
      return providerNotices;
    }

    final payloadNotices = payload?['notices'];
    if (payloadNotices is List && payloadNotices.isNotEmpty) {
      return payloadNotices;
    }

    return const [];
  }

  String? _getClientLogoUrl() {
    return providerData?['profile']?['image_url']?.toString() ??
        providerData?['image_url']?.toString() ??
        payload?['client_logo_url']?.toString();
  }

  String _getDefaultZoneMediaMode(Map<String, dynamic> zone) {
    final role = (zone['role'] ?? '').toString().toLowerCase();
    return (role == 'header' || role == 'weather') ? 'fill' : 'fit';
  }

  Widget _buildMenuButton(List<Map<String, dynamic>> zones) {
    return TextButton.icon(
      autofocus: !menuOpen,
      onPressed: _toggleMenu,
      icon: Icon(menuOpen ? Icons.close : Icons.menu, size: 16),
      label: const Text(
        'MENU',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          letterSpacing: 2,
        ),
      ),
      style: ButtonStyle(
        padding: WidgetStateProperty.all(
          const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        ),
        foregroundColor: WidgetStateProperty.all(Colors.white),
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.focused)) {
            return const Color(0xFF0EA5E9);
          }
          return Colors.black87;
        }),
        shape: WidgetStateProperty.all(
          RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
            side: const BorderSide(color: Colors.white24),
          ),
        ),
        overlayColor: WidgetStateProperty.all(Colors.white10),
      ),
    );
  }

  Widget _buildMenuOverlay(
    List<Map<String, dynamic>> zones,
    double payloadBrightness,
    double effectiveBrightnessPercent,
  ) {
    return FocusTraversalGroup(
      child: Container(
        color: Colors.black.withOpacity(0.78),
        child: SafeArea(
          child: Center(
            child: Container(
            width: double.infinity,
            height: double.infinity,
            decoration: BoxDecoration(
              color: const Color(0xFA0F172A),
              borderRadius: BorderRadius.circular(0),
              border: Border.all(color: Colors.white10),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.9),
                  blurRadius: 90,
                  offset: const Offset(0, 28),
                ),
              ],
            ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(0),
                child: SingleChildScrollView(
                  child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFA0F172A),
                        border: Border(
                          bottom: BorderSide(color: Colors.white.withOpacity(0.1)),
                        ),
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text(
                                  'PLAYER MENU',
                                  style: TextStyle(
                                    fontSize: 10,
                                    letterSpacing: 3,
                                    color: Colors.white38,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                const Text(
                                  'Controls, brightness, and zones',
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w600,
                                    color: Colors.white,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          _buildMenuButtonItem(
                            icon: Icons.close,
                            label: 'Close',
                            onTap: _toggleMenu,
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'CONTROLS',
                            style: TextStyle(
                              fontSize: 10,
                              letterSpacing: 3,
                              color: Colors.white38,
                            ),
                          ),
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              _buildMenuButtonItem(
                                icon: Icons.fullscreen,
                                label: 'Fullscreen',
                                onTap: _goFullscreen,
                              ),
                              _buildMenuButtonItem(
                                icon: Icons.refresh,
                                label: 'Reload',
                                onTap: _poll,
                              ),
                              _buildMenuButtonItem(
                                icon: Icons.smartphone,
                                label: 'Change Device',
                                onTap: _attemptChangeDevice,
                              ),
                              _buildMenuButtonItem(
                                icon: Icons.exit_to_app,
                                label: 'Quit App',
                                onTap: _attemptQuitApp,
                              ),
                              _buildMenuButtonItem(
                                icon: Icons.restore,
                                label: 'Restore All Zones',
                                onTap: _resetZones,
                              ),
                              _buildMenuButtonItem(
                                icon: kioskModeEnabled ? Icons.lock : Icons.lock_open,
                                label: kioskModeEnabled ? 'Kiosk: ON' : 'Kiosk: OFF',
                                onTap: _toggleKioskMode,
                              ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          const Text(
                            'BRIGHTNESS',
                            style: TextStyle(
                              fontSize: 10,
                              letterSpacing: 3,
                              color: Colors.white38,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            decoration: BoxDecoration(
                              color: Colors.white.withOpacity(0.05),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: Colors.white10),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Text(
                                      'Output ${effectiveBrightnessPercent.round()}%',
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    const Spacer(),
                                    Text(
                                      brightnessOverridePercent == null
                                          ? 'Source: Payload ${payloadBrightness.round()}%'
                                          : 'Source: Manual',
                                      style: TextStyle(
                                        color: Colors.white.withOpacity(0.6),
                                        fontSize: 11,
                                      ),
                                    ),
                                  ],
                                ),
                                Slider(
                                  value: effectiveBrightnessPercent,
                                  min: 10,
                                  max: 100,
                                  divisions: 18,
                                  label: '${effectiveBrightnessPercent.round()}%',
                                  onChanged: _setBrightnessOverride,
                                ),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: [
                                    _buildMenuButtonItem(
                                      icon: Icons.brightness_low,
                                      label: '40%',
                                      onTap: () => _setBrightnessOverride(40),
                                    ),
                                    _buildMenuButtonItem(
                                      icon: Icons.brightness_medium,
                                      label: '70%',
                                      onTap: () => _setBrightnessOverride(70),
                                    ),
                                    _buildMenuButtonItem(
                                      icon: Icons.brightness_high,
                                      label: '100%',
                                      onTap: () => _setBrightnessOverride(100),
                                    ),
                                    _buildMenuButtonItem(
                                      icon: Icons.auto_mode,
                                      label: 'Use Payload',
                                      onTap: _setAutoBrightnessFromPayload,
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 16),
                          const Text(
                            'WIDGET STYLE',
                            style: TextStyle(
                              fontSize: 10,
                              letterSpacing: 3,
                              color: Colors.white38,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            decoration: BoxDecoration(
                              color: Colors.white.withOpacity(0.05),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: Colors.white10),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Weather/Clock size ${(weatherClockScale * 100).round()}%',
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                Slider(
                                  value: weatherClockScale,
                                  min: 0.7,
                                  max: 1.5,
                                  divisions: 8,
                                  label: '${(weatherClockScale * 100).round()}%',
                                  onChanged: _setWeatherClockScale,
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  'Text color',
                                  style: TextStyle(
                                    color: Colors.white.withOpacity(0.7),
                                    fontSize: 11,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: _themeColors.entries.map((entry) {
                                    final selected = weatherClockTextColorKey == entry.key;
                                    return _buildColorChoice(
                                      selected: selected,
                                      color: entry.value,
                                      label: entry.key.toUpperCase(),
                                      onTap: () => _setWeatherClockTextColor(entry.key),
                                    );
                                  }).toList(),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 16),
                          const Text(
                            'RSS / TICKER',
                            style: TextStyle(
                              fontSize: 10,
                              letterSpacing: 3,
                              color: Colors.white38,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            decoration: BoxDecoration(
                              color: Colors.white.withOpacity(0.05),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: Colors.white10),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Ticker speed ${tickerSpeed.round()}',
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                Slider(
                                  value: tickerSpeed,
                                  min: 20,
                                  max: 140,
                                  divisions: 12,
                                  label: '${tickerSpeed.round()}',
                                  onChanged: _setTickerSpeed,
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  'Ticker text color',
                                  style: TextStyle(
                                    color: Colors.white.withOpacity(0.7),
                                    fontSize: 11,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: _themeColors.entries.map((entry) {
                                    final selected = tickerTextColorKey == entry.key;
                                    return _buildColorChoice(
                                      selected: selected,
                                      color: entry.value,
                                      label: entry.key.toUpperCase(),
                                      onTap: () => _setTickerTextColor(entry.key),
                                    );
                                  }).toList(),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  'Ticker background',
                                  style: TextStyle(
                                    color: Colors.white.withOpacity(0.7),
                                    fontSize: 11,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: [
                                    _buildColorChoice(
                                      selected: tickerBackgroundColorKey == 'black',
                                      color: Colors.black,
                                      label: 'BLACK',
                                      onTap: () => _setTickerBackgroundColor('black'),
                                    ),
                                    _buildColorChoice(
                                      selected: tickerBackgroundColorKey == 'navy',
                                      color: const Color(0xFF0B1220),
                                      label: 'NAVY',
                                      onTap: () => _setTickerBackgroundColor('navy'),
                                    ),
                                    _buildColorChoice(
                                      selected: tickerBackgroundColorKey == 'transparent',
                                      color: Colors.white10,
                                      label: 'TRANSPARENT',
                                      onTap: () => _setTickerBackgroundColor('transparent'),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 16),
                          const Text(
                            'ORIENTATION',
                            style: TextStyle(
                              fontSize: 10,
                              letterSpacing: 3,
                              color: Colors.white38,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: ['auto', 'landscape', 'portrait'].map((mode) {
                              final isSelected = orientationOverride == mode;
                              return Expanded(
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 4),
                                  child: GestureDetector(
                                    onTap: () => _setOrientation(mode),
                                    child: Container(
                                      padding: const EdgeInsets.symmetric(vertical: 8),
                                      decoration: BoxDecoration(
                                        color: isSelected
                                            ? Colors.cyan.withOpacity(0.2)
                                            : Colors.white.withOpacity(0.05),
                                        borderRadius: BorderRadius.circular(12),
                                        border: Border.all(
                                          color: isSelected
                                              ? Colors.cyan.withOpacity(0.4)
                                              : Colors.white10,
                                        ),
                                      ),
                                      child: Text(
                                        mode.toUpperCase(),
                                        textAlign: TextAlign.center,
                                        style: TextStyle(
                                          fontSize: 10,
                                          fontWeight: FontWeight.w600,
                                          letterSpacing: 2,
                                          color: isSelected
                                              ? Colors.cyanAccent
                                              : Colors.white70,
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              );
                            }).toList(),
                          ),
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              _buildMenuButtonItem(
                                icon: fillBlankSpaces ? Icons.view_agenda : Icons.view_column,
                                label: fillBlankSpaces ? 'FILL BLANK SPACES' : 'PACK ZONES',
                                onTap: () => _setFillBlankSpaces(!fillBlankSpaces),
                              ),
                              _buildMenuButtonItem(
                                icon: customPlacementEnabled ? Icons.place : Icons.linear_scale,
                                label: customPlacementEnabled ? 'CUSTOM PLACEMENT ON' : 'CUSTOM PLACEMENT OFF',
                                onTap: () => _setCustomPlacementEnabled(!customPlacementEnabled),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    Container(
                      height: 1,
                      color: Colors.white.withOpacity(0.1),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Text(
                                'ZONE SETTINGS',
                                style: TextStyle(
                                  fontSize: 10,
                                  letterSpacing: 3,
                                  color: Colors.white38,
                                ),
                              ),
                              Text(
                                '${zones.where((z) => !hiddenZoneIds.contains(z['id'])).length}/${zones.length}',
                                style: const TextStyle(
                                  fontSize: 10,
                                  letterSpacing: 2,
                                  color: Colors.white30,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          ...zones.map((zone) {
                            final zoneId = zone['id']?.toString() ?? '';
                            final zoneName = zone['name']?.toString() ?? '';
                            final zoneRole = zone['role']?.toString() ?? '';
                            final isHidden = hiddenZoneIds.contains(zoneId);

                            return Container(
                              margin: const EdgeInsets.only(bottom: 8),
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.05),
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: Colors.white10),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              zoneName,
                                              style: const TextStyle(
                                                color: Colors.white,
                                                fontWeight: FontWeight.w500,
                                              ),
                                            ),
                                            Text(
                                              '$zoneRole · ${zone['width_px'] ?? 0}x${zone['height_px'] ?? 0}',
                                              style: TextStyle(
                                                fontSize: 11,
                                                color: Colors.white.withOpacity(0.4),
                                                letterSpacing: 2,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                      GestureDetector(
                                        onTap: () {
                                          setState(() {
                                            if (isHidden) {
                                              hiddenZoneIds.remove(zoneId);
                                            } else {
                                              hiddenZoneIds.add(zoneId);
                                            }
                                          });
                                          _saveZonePreferences();
                                        },
                                        child: Container(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 12,
                                            vertical: 6,
                                          ),
                                          decoration: BoxDecoration(
                                            color: isHidden
                                                ? Colors.white.withOpacity(0.1)
                                                : Colors.red.withOpacity(0.15),
                                            borderRadius: BorderRadius.circular(20),
                                          ),
                                          child: Row(
                                            mainAxisSize: MainAxisSize.min,
                                            children: [
                                              Icon(
                                                isHidden ? Icons.visibility : Icons.visibility_off,
                                                size: 14,
                                                color: isHidden ? Colors.white70 : Colors.redAccent,
                                              ),
                                              const SizedBox(width: 4),
                                              Text(
                                                isHidden ? 'SHOW' : 'HIDE',
                                                style: TextStyle(
                                                  fontSize: 10,
                                                  fontWeight: FontWeight.w600,
                                                  letterSpacing: 2,
                                                  color: isHidden ? Colors.white70 : Colors.redAccent,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 10),
                                  DropdownButtonFormField<String>(
                                    value: zoneMediaModes[zoneId] ?? _getDefaultZoneMediaMode(zone),
                                    isDense: true,
                                    dropdownColor: const Color(0xFF111827),
                                    decoration: InputDecoration(
                                      labelText: 'Media mode',
                                      labelStyle: const TextStyle(color: Colors.white54, fontSize: 12),
                                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                      border: OutlineInputBorder(
                                        borderRadius: BorderRadius.circular(12),
                                        borderSide: BorderSide(color: Colors.white.withOpacity(0.1)),
                                      ),
                                      enabledBorder: OutlineInputBorder(
                                        borderRadius: BorderRadius.circular(12),
                                        borderSide: BorderSide(color: Colors.white.withOpacity(0.1)),
                                      ),
                                    ),
                                    style: const TextStyle(color: Colors.white, fontSize: 12),
                                    items: const [
                                      DropdownMenuItem(value: 'fit', child: Text('FIT')),
                                      DropdownMenuItem(value: 'fill', child: Text('FILL')),
                                      DropdownMenuItem(value: 'stretch', child: Text('STRETCH')),
                                    ],
                                    onChanged: (value) {
                                      if (value != null) _setZoneMediaMode(zoneId, value);
                                    },
                                  ),
                                  if (customPlacementEnabled) ...[
                                    const SizedBox(height: 10),
                                    DropdownButtonFormField<String>(
                                      value: zonePlacements[zoneId] ?? 'auto',
                                      isDense: true,
                                      dropdownColor: const Color(0xFF111827),
                                      decoration: InputDecoration(
                                        labelText: 'Placement',
                                        labelStyle: const TextStyle(color: Colors.white54, fontSize: 12),
                                        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                        border: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(12),
                                          borderSide: BorderSide(color: Colors.white.withOpacity(0.1)),
                                        ),
                                        enabledBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(12),
                                          borderSide: BorderSide(color: Colors.white.withOpacity(0.1)),
                                        ),
                                      ),
                                      style: const TextStyle(color: Colors.white, fontSize: 12),
                                      items: const [
                                        DropdownMenuItem(value: 'auto', child: Text('AUTO')),
                                        DropdownMenuItem(value: 'full', child: Text('FULL')),
                                        DropdownMenuItem(value: 'left', child: Text('LEFT')),
                                        DropdownMenuItem(value: 'right', child: Text('RIGHT')),
                                        DropdownMenuItem(value: 'top', child: Text('TOP')),
                                        DropdownMenuItem(value: 'bottom', child: Text('BOTTOM')),
                                        DropdownMenuItem(value: 'center', child: Text('CENTER')),
                                      ],
                                      onChanged: (value) {
                                        if (value != null) _setZonePlacement(zoneId, value);
                                      },
                                    ),
                                  ],
                                ],
                              ),
                            );
                          }),
                        ],
                      ),
                    ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildMenuButtonItem({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return TextButton.icon(
      onPressed: onTap,
      icon: Icon(icon, size: 16),
      label: Text(
        label,
        style: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w500,
        ),
      ),
      style: ButtonStyle(
        padding: WidgetStateProperty.all(
          const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        ),
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          return states.contains(WidgetState.focused)
              ? Colors.black
              : Colors.white;
        }),
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.focused)) {
            return Colors.cyanAccent;
          }
          return Colors.white.withOpacity(0.05);
        }),
        shape: WidgetStateProperty.all(
          RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: Colors.white10),
          ),
        ),
        overlayColor: WidgetStateProperty.all(Colors.white10),
      ),
    );
  }

  Widget _buildColorChoice({
    required bool selected,
    required Color color,
    required String label,
    required VoidCallback onTap,
  }) {
    return TextButton(
      onPressed: onTap,
      style: ButtonStyle(
        padding: WidgetStateProperty.all(
          const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        ),
        backgroundColor: WidgetStateProperty.all(
          selected ? Colors.white12 : Colors.white.withOpacity(0.03),
        ),
        shape: WidgetStateProperty.all(
          RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(
              color: selected ? Colors.cyanAccent : Colors.white24,
              width: selected ? 1.5 : 1,
            ),
          ),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 14,
            height: 14,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white30),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            label,
            style: TextStyle(
              color: selected ? Colors.cyanAccent : Colors.white,
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: 1,
            ),
          ),
        ],
      ),
    );
  }
}

// Splash Screen (same as before, no changes needed)
class ModernSplashScreen extends StatefulWidget {
  const ModernSplashScreen({super.key});

  @override
  State<ModernSplashScreen> createState() => _ModernSplashScreenState();
}

class _ModernSplashScreenState extends State<ModernSplashScreen>
    with TickerProviderStateMixin {
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;
  late AnimationController _progressController;
  String dots = "";
  int dotCount = 0;
  Timer? dotTimer;

  @override
  void initState() {
    super.initState();

    _pulseController = AnimationController(
      duration: const Duration(seconds: 2),
      vsync: this,
    );

    _pulseAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );

    _progressController = AnimationController(
      duration: const Duration(seconds: 2),
      vsync: this,
    );

    _pulseController.repeat(reverse: true);
    _progressController.forward();

    dotTimer = Timer.periodic(const Duration(milliseconds: 500), (timer) {
      setState(() {
        dotCount = (dotCount + 1) % 4;
        dots = '.' * dotCount;
      });
    });

    Future.delayed(const Duration(seconds: 3), () {
      dotTimer?.cancel();
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const SignagePlayer()),
        );
      }
    });
  }

  @override
  void dispose() {
    _pulseController.dispose();
    _progressController.dispose();
    dotTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              Color(0xFF4A148C),
              Color(0xFFAD1457),
              Color(0xFFE65100),
            ],
          ),
        ),
        child: Stack(
          children: [
            Positioned(
              top: -150,
              right: -150,
              child: AnimatedBuilder(
                listenable: _pulseAnimation,
                builder: (context, child) {
                  return Container(
                    width: 300 + (_pulseAnimation.value * 20),
                    height: 300 + (_pulseAnimation.value * 20),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.1),
                      shape: BoxShape.circle,
                    ),
                  );
                },
              ),
            ),
            Positioned(
              bottom: -150,
              left: -150,
              child: AnimatedBuilder(
                listenable: _pulseAnimation,
                builder: (context, child) {
                  return Container(
                    width: 300 + ((1 - _pulseAnimation.value) * 20),
                    height: 300 + ((1 - _pulseAnimation.value) * 20),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.1),
                      shape: BoxShape.circle,
                    ),
                  );
                },
              ),
            ),
            Positioned(
              top: MediaQuery.of(context).size.height / 2 - 200,
              left: MediaQuery.of(context).size.width / 2 - 200,
              child: AnimatedBuilder(
                listenable: _pulseAnimation,
                builder: (context, child) {
                  return Container(
                    width: 400,
                    height: 400,
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.05 * _pulseAnimation.value),
                      shape: BoxShape.circle,
                    ),
                  );
                },
              ),
            ),
            Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  AnimatedBuilder(
                    listenable: _pulseAnimation,
                    builder: (context, child) {
                      return Transform.scale(
                        scale: 1.0 + (_pulseAnimation.value * 0.1),
                        child: child,
                      );
                    },
                    child: const Column(
                      children: [
                        Text(
                          'RP',
                          style: TextStyle(
                            fontSize: 120,
                            fontWeight: FontWeight.w900,
                            color: Colors.white,
                            letterSpacing: -4,
                          ),
                        ),
                        Text(
                          'SIGNAGE',
                          style: TextStyle(
                            fontSize: 14,
                            color: Colors.white70,
                            letterSpacing: 8,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 40),
                  Container(
                    width: 250,
                    height: 2,
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.2),
                      borderRadius: BorderRadius.circular(1),
                    ),
                    child: AnimatedBuilder(
                      listenable: _progressController,
                      builder: (context, child) {
                        return ClipRRect(
                          borderRadius: BorderRadius.circular(1),
                          child: LinearProgressIndicator(
                            value: _progressController.value,
                            backgroundColor: Colors.transparent,
                            valueColor: const AlwaysStoppedAnimation<Color>(Colors.white),
                          ),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Loading$dots',
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.white.withOpacity(0.6),
                      letterSpacing: 3,
                    ),
                  ),
                  const SizedBox(height: 40),
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    alignment: WrapAlignment.center,
                    children: [
                      _buildFeatureTag(Icons.smartphone, 'Multi-Device'),
                      _buildFeatureTag(Icons.tv, '4K Ready'),
                      _buildFeatureTag(Icons.wifi, 'Cloud Sync'),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFeatureTag(IconData icon, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.1),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white.withOpacity(0.1)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: Colors.white60),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              fontSize: 10,
              color: Colors.white60,
              letterSpacing: 1,
            ),
          ),
        ],
      ),
    );
  }
}

// Pairing Screen (same as before)
class PairingScreen extends StatefulWidget {
  final Function(String) onPair;
  final String error;
  final String? initialCode;
  final VoidCallback? onRequestCode;

  const PairingScreen({
    super.key,
    required this.onPair,
    required this.error,
    this.initialCode,
    this.onRequestCode,
  });

  @override
  State<PairingScreen> createState() => _PairingScreenState();
}

class _PairingScreenState extends State<PairingScreen> {
  bool isLoading = false;
  bool isConnecting = false;

  @override
  void initState() {
    super.initState();
    isLoading = true;
    isConnecting = true;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              Color(0xFF1A237E),
              Color(0xFF4A148C),
              Color(0xFF1A237E),
            ],
          ),
        ),
        child: Stack(
          children: [
            Positioned.fill(
              child: Opacity(
                opacity: 0.05,
                child: CustomPaint(
                  painter: GridPatternPainter(),
                ),
              ),
            ),
            Positioned(
              top: 80,
              left: 40,
              child: Container(
                width: 250,
                height: 250,
                decoration: BoxDecoration(
                  color: Colors.purple.withOpacity(0.2),
                  shape: BoxShape.circle,
                ),
              ),
            ),
            Positioned(
              bottom: 80,
              right: 40,
              child: Container(
                width: 250,
                height: 250,
                decoration: BoxDecoration(
                  color: Colors.pink.withOpacity(0.2),
                  shape: BoxShape.circle,
                ),
              ),
            ),
            Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      'RP',
                      style: TextStyle(
                        fontSize: 60,
                        fontWeight: FontWeight.w900,
                        color: Colors.white,
                      ),
                    ),
                    const Text(
                      'SIGNAGE PLAYER',
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.white54,
                        letterSpacing: 4,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      width: 48,
                      height: 1,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            Colors.transparent,
                            Colors.white.withOpacity(0.3),
                            Colors.transparent,
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 32),
                    Container(
                      width: 400,
                      padding: const EdgeInsets.all(32),
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(color: Colors.white24),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.5),
                            blurRadius: 40,
                            offset: const Offset(0, 20),
                          ),
                        ],
                      ),
                      child: Column(
                        children: [
                          const Text(
                            'PAIRING',
                            style: TextStyle(
                              fontSize: 12,
                              letterSpacing: 6,
                              color: Colors.white54,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 32),
                          Text(
                            'Device pairing code',
                            style: TextStyle(
                              fontSize: 12,
                              color: Colors.white.withOpacity(0.5),
                            ),
                          ),
                          const SizedBox(height: 12),
                          Text(
                            (widget.initialCode != null && widget.initialCode!.isNotEmpty)
                                ? widget.initialCode!.substring(0, min(6, widget.initialCode!.length))
                                : '••••••',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 56,
                              fontFamily: 'monospace',
                              letterSpacing: 8,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 12),
                          Text(
                            widget.initialCode != null && widget.initialCode!.isNotEmpty
                                ? 'Show this code in the client portal to pair the device'
                                : 'Requesting a new code...',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 12,
                              color: Colors.white.withOpacity(0.35),
                            ),
                          ),
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: Colors.white.withOpacity(0.03),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: Colors.white10),
                            ),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                  const SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.cyanAccent),
                                  ),
                                  const SizedBox(height: 10),
                                  Text(
                                    widget.initialCode != null && widget.initialCode!.isNotEmpty
                                        ? 'Waiting for client confirmation'
                                        : 'Requesting code from server...',
                                    style: const TextStyle(color: Colors.white54),
                                  ),
                              ],
                            ),
                          ),
                          if (widget.error.isNotEmpty) ...[
                            const SizedBox(height: 16),
                            Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: Colors.red.withOpacity(0.2),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: Colors.red.withOpacity(0.3)),
                              ),
                              child: Row(
                                children: [
                                  const Icon(
                                    Icons.error_outline,
                                    color: Colors.redAccent,
                                    size: 20,
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      widget.error,
                                      style: const TextStyle(
                                        color: Colors.redAccent,
                                        fontSize: 14,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                          const SizedBox(height: 24),
                        ],
                      ),
                    ),
                    const SizedBox(height: 24),
                    Text(
                      'Secure connection · End-to-end encrypted',
                      style: TextStyle(
                        fontSize: 10,
                        color: Colors.white.withOpacity(0.2),
                        letterSpacing: 2,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class GridPatternPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white
      ..strokeWidth = 1;

    for (double i = 0; i < size.width; i += 60) {
      canvas.drawLine(Offset(i, 0), Offset(i, size.height), paint);
    }
    for (double i = 0; i < size.height; i += 60) {
      canvas.drawLine(Offset(0, i), Offset(size.width, i), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

// Media Slot Widget (scrollable version to prevent overflow)
class MediaSlot extends StatefulWidget {
  final List<Map<String, dynamic>> items;
  final String label;
  final String mediaMode;
  final List<dynamic> queuePreview;
  final List<dynamic> todayBookingsPreview;
  final List<dynamic> liveQueue;
  final List<dynamic> notices;
  final double weatherClockScale;
  final Color weatherClockTextColor;

  const MediaSlot({
    super.key,
    required this.items,
    required this.label,
    this.mediaMode = 'fill',
    this.queuePreview = const [],
    this.todayBookingsPreview = const [],
    this.liveQueue = const [],
    this.notices = const [],
    this.weatherClockScale = 1.0,
    this.weatherClockTextColor = Colors.white,
  });

  static _MediaSlotState? _activeAudioState;

  static void _claimAudioFocus(_MediaSlotState state) {
    final current = _activeAudioState;
    if (current != null && !identical(current, state)) {
      current._pausePlaybackForFocusLoss();
    }
    _activeAudioState = state;
  }

  static void _releaseAudioFocus(_MediaSlotState state) {
    if (identical(_activeAudioState, state)) {
      _activeAudioState = null;
    }
  }

  @override
  State<MediaSlot> createState() => _MediaSlotState();
}

class _MediaSlotState extends State<MediaSlot> {
  int currentIndex = 0;
  Timer? timer;
  Timer? controlsHideTimer;
  bool showFrame = true;
  bool isMuted = true;
  bool showPlaybackControls = false;
  String? videoError;
  YoutubePlayerController? youtubeController;
  VideoPlayerController? videoController;
  bool _videoCompletionHandled = false;
  bool _youtubeCompletionHandled = false;
  String? _activeVideoSourceKey;

  void _pausePlaybackForFocusLoss() {
    youtubeController?.pause();
    videoController?.pause();
  }

  @override
  void initState() {
    super.initState();
    if (widget.items.isNotEmpty) {
      _setupTimer();
    }
  }

  @override
  void didUpdateWidget(MediaSlot oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_itemsSignature(oldWidget.items) != _itemsSignature(widget.items)) {
      setState(() => currentIndex = 0);
      _setupTimer();
    }
  }

  String _itemsSignature(List<Map<String, dynamic>> items) {
    return items.map((item) {
      final type = (item['type'] ?? item['kind'] ?? '').toString().toLowerCase();
      final mediaId = item['media_id']?.toString() ?? '';
      final url = _resolveUrl(item);
      final duration = (item['duration'] ?? '').toString();
      return '$type|$mediaId|$url|$duration';
    }).join('||');
  }

  void _setupTimer() {
    timer?.cancel();
    if (widget.items.isEmpty || currentIndex >= widget.items.length) return;

    final item = widget.items[currentIndex];
    final duration = (item['duration'] ?? 10).toInt();
    final itemType = _resolveItemType(item);

    if (itemType != 'video' && itemType != 'youtube') {
      timer = Timer(Duration(seconds: duration), _nextItem);
    }
  }

  String _resolveItemType(Map<String, dynamic> item) {
    final rawType = (item['type'] ?? item['kind'] ?? 'media').toString().toLowerCase();
    final itemUrl = _resolveUrl(item);

    if (rawType == 'media') {
      if (_getYoutubeId(item['url']?.toString() ?? '') != null) {
        return 'youtube';
      }
      if (_isVideoUrl(itemUrl) || _isVideoContentType(item)) {
        return 'video';
      }
    }

    return rawType;
  }

  void _applyMuteState() {
    if (youtubeController != null) {
      if (isMuted) {
        youtubeController!.mute();
      } else {
        youtubeController!.unMute();
      }
    }

    if (videoController != null && videoController!.value.isInitialized) {
      videoController!.setVolume(isMuted ? 0.0 : 1.0);
    }
  }

  void _disposePlaybackControllers() {
    youtubeController?.dispose();
    youtubeController = null;
    videoController?.dispose();
    videoController = null;
    _activeVideoSourceKey = null;
    _videoCompletionHandled = false;
    _youtubeCompletionHandled = false;
  }

  void _restartCurrentVideo() {
    if (!mounted) return;
    videoController?.dispose();
    videoController = null;
    _activeVideoSourceKey = null;
    _videoCompletionHandled = false;
    setState(() {});
  }

  void _toggleMute() {
    setState(() {
      isMuted = !isMuted;
    });
    _applyMuteState();
  }

  void _showPlaybackControlsTemporarily() {
    controlsHideTimer?.cancel();
    setState(() {
      showPlaybackControls = true;
    });
    controlsHideTimer = Timer(const Duration(seconds: 4), () {
      if (!mounted) return;
      setState(() {
        showPlaybackControls = false;
      });
    });
  }

  void _togglePlaybackOverlayVisibility() {
    if (showPlaybackControls) {
      controlsHideTimer?.cancel();
      setState(() {
        showPlaybackControls = false;
      });
      return;
    }
    _showPlaybackControlsTemporarily();
  }

  void _nextItem() {
    if (!mounted) return;
    controlsHideTimer?.cancel();
    _disposePlaybackControllers();
    setState(() {
      currentIndex = (currentIndex + 1) % widget.items.length;
      showFrame = false;
      videoError = null;
      showPlaybackControls = false;
    });
    Future.delayed(const Duration(milliseconds: 30), () {
      if (mounted) {
        setState(() => showFrame = true);
        _setupTimer();
      }
    });
  }

  void _handleMediaCompletion(VoidCallback replayCurrent) {
    if (!mounted) return;

    // For playlists with multiple items, always move to the next item (wrap handled in _nextItem).
    if (widget.items.length > 1) {
      _nextItem();
      return;
    }

    replayCurrent();
  }

  bool _isVideoPlaybackCompleted(VideoPlayerValue value) {
    if (!value.isInitialized) return false;

    final duration = value.duration;
    final position = value.position;

    // Ignore bogus/very-short durations that can be reported transiently.
    if (duration.inMilliseconds < 1000) return false;

    if (value.isCompleted) return true;

    // Allow a small tolerance for decoder timing drift near the tail.
    const tailTolerance = Duration(milliseconds: 250);
    final nearEnd = position >= (duration - tailTolerance);
    return nearEnd && !value.isPlaying;
  }

  bool _isLikelyEndOfStreamError(String message) {
    final normalized = message.toLowerCase();
    return normalized.contains('eofexception') ||
        normalized.contains('source error') ||
        normalized.contains('end of stream') ||
        normalized.contains('behind live window');
  }

  @override
  void dispose() {
    MediaSlot._releaseAudioFocus(this);
    timer?.cancel();
    controlsHideTimer?.cancel();
    youtubeController?.dispose();
    videoController?.dispose();
    super.dispose();
  }

  BoxFit _getMediaFit() {
    switch (widget.mediaMode) {
      case 'contain':
        return BoxFit.contain;
      case 'stretch':
        return BoxFit.fill;
      default:
        return BoxFit.cover;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.items.isEmpty) {
      return Container(
        color: Colors.black,
        child: Center(
          child: Text(
            widget.label.toUpperCase(),
            style: TextStyle(
              color: Colors.white.withOpacity(0.3),
              fontSize: 12,
              fontFamily: 'monospace',
              letterSpacing: 3,
            ),
          ),
        ),
      );
    }

    final item = widget.items[currentIndex];
    final itemType = _resolveItemType(item);

    if (itemType != 'video' && itemType != 'youtube') {
      _disposePlaybackControllers();
    }

    Widget content;

    switch (itemType) {
      case 'clock':
        content = _buildClock(item);
        break;
      case 'weather':
        content = _buildWeather(item);
        break;
      case 'text':
        content = _buildText(item);
        break;
      case 'youtube':
        content = _buildVideoLikeZone(_buildYoutube(item));
        break;
      case 'video':
        content = _buildVideoLikeZone(_buildVideo(item));
        break;
      case 'bookings':
      case 'queue':
        content = _buildBookings(item);
        break;
      case 'notices':
        content = _buildNotices(item);
        break;
      default:
        content = _buildMedia(item);
    }

    return AnimatedOpacity(
      opacity: showFrame ? 1.0 : 0.0,
      duration: const Duration(milliseconds: 500),
      child: AnimatedScale(
        scale: showFrame ? 1.0 : 1.01,
        duration: const Duration(milliseconds: 500),
        child: LayoutBuilder(
          builder: (context, constraints) {
            return ClipRect(
              child: FittedBox(
                fit: BoxFit.contain,
                alignment: Alignment.topLeft,
                child: SizedBox(
                  width: constraints.maxWidth,
                  height: constraints.maxHeight,
                  child: content,
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildVideoLikeZone(Widget child) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: _togglePlaybackOverlayVisibility,
      child: Stack(
        fit: StackFit.expand,
        children: [
          child,
          if (showPlaybackControls) _buildPlaybackOverlay(),
        ],
      ),
    );
  }

  Widget _buildPlaybackOverlay() {
    final hasVideo = videoController != null && videoController!.value.isInitialized;
    final hasYoutube = youtubeController != null;

    if (!hasVideo && !hasYoutube) {
      return const SizedBox.shrink();
    }

    return Positioned(
      left: 0,
      right: 0,
      bottom: 0,
      child: Container(
        height: 76,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        color: Colors.black.withOpacity(0.45),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
            IconButton(
              onPressed: () {
                if (hasVideo) {
                  if (videoController!.value.isPlaying) {
                    videoController!.pause();
                  } else {
                    videoController!.play();
                  }
                } else if (hasYoutube) {
                  if (youtubeController!.value.isPlaying) {
                    youtubeController!.pause();
                  } else {
                    youtubeController!.play();
                  }
                }
                setState(() {});
                _showPlaybackControlsTemporarily();
              },
              icon: Icon(
                (hasVideo && videoController!.value.isPlaying) ||
                        (hasYoutube && youtubeController!.value.isPlaying)
                    ? Icons.pause_circle_filled
                    : Icons.play_circle_fill,
                color: Colors.white,
                size: 32,
              ),
            ),
            if (hasVideo)
              SizedBox(
                width: 140,
                child: VideoProgressIndicator(
                  videoController!,
                  allowScrubbing: true,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  colors: const VideoProgressColors(
                    playedColor: Colors.cyanAccent,
                    bufferedColor: Colors.white24,
                    backgroundColor: Colors.white12,
                  ),
                ),
              )
            else
              const SizedBox(width: 12),
            IconButton(
              onPressed: () async {
                if (hasVideo) {
                  await videoController!.seekTo(Duration.zero);
                  await videoController!.play();
                } else if (hasYoutube) {
                  youtubeController!.seekTo(const Duration(seconds: 0));
                  youtubeController!.play();
                }
                setState(() {});
                _showPlaybackControlsTemporarily();
              },
              icon: const Icon(
                Icons.replay,
                color: Colors.white,
                size: 28,
              ),
            ),
            TextButton.icon(
              onPressed: () {
                _toggleMute();
                _showPlaybackControlsTemporarily();
              },
              icon: Icon(
                isMuted ? Icons.volume_off : Icons.volume_up,
                color: Colors.white,
                size: 18,
              ),
              label: Text(
                isMuted ? 'UNMUTE' : 'MUTE',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                  fontSize: 11,
                  letterSpacing: 0.8,
                ),
              ),
            ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildClock(Map<String, dynamic> item) {
    final scaleFactor = widget.weatherClockScale.clamp(0.7, 1.5);
    final textColor = widget.weatherClockTextColor;

    return StreamBuilder(
      stream: Stream.periodic(const Duration(seconds: 1)),
      builder: (context, snapshot) {
        final now = DateTime.now();
        final time = '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
        final date = '${_getWeekday(now.weekday)}, ${_getMonth(now.month)} ${now.day}';

        return Container(
          width: double.infinity,
          height: double.infinity,
          decoration: BoxDecoration(
            gradient: RadialGradient(
              center: Alignment.topCenter,
              colors: [const Color(0x24FFFFFF), Colors.transparent],
            ),
          ),
          child: Container(
            width: double.infinity,
            height: double.infinity,
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0xFF1F2937), Color(0xFF0B1120)],
              ),
            ),
            padding: EdgeInsets.all(20 * scaleFactor),
            child: LayoutBuilder(
              builder: (context, constraints) {
                return SingleChildScrollView(
                  child: ConstrainedBox(
                    constraints: BoxConstraints(minHeight: constraints.maxHeight),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              (item['title'] ?? 'Today').toString().toUpperCase(),
                              style: TextStyle(
                                fontSize: 10 * scaleFactor,
                                letterSpacing: 4.5,
                                color: textColor.withOpacity(0.45),
                              ),
                            ),
                            SizedBox(height: 8 * scaleFactor),
                            Text(
                              item['location']?.toString() ?? 'Local time',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 14 * scaleFactor,
                                color: textColor.withOpacity(0.7),
                              ),
                            ),
                          ],
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(
                              width: double.infinity,
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                                alignment: Alignment.centerLeft,
                                child: Text(
                                  time,
                                  style: TextStyle(
                                    fontSize: 72 * scaleFactor,
                                    fontWeight: FontWeight.w900,
                                    color: textColor,
                                    letterSpacing: -2,
                                  ),
                                ),
                              ),
                            ),
                            SizedBox(height: 8 * scaleFactor),
                            SizedBox(
                              width: double.infinity,
                              child: FittedBox(
                                fit: BoxFit.scaleDown,
                                alignment: Alignment.centerLeft,
                                child: Text(
                                  date,
                                  style: TextStyle(
                                    fontSize: 18 * scaleFactor,
                                    color: textColor.withOpacity(0.8),
                                  ),
                                ),
                              ),
                            ),
                            SizedBox(height: 16 * scaleFactor),
                            Container(
                              padding: EdgeInsets.symmetric(
                                horizontal: 12 * scaleFactor,
                                vertical: 6 * scaleFactor,
                              ),
                              decoration: BoxDecoration(
                                color: textColor.withOpacity(0.05),
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(color: textColor.withOpacity(0.2)),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    'LIVE',
                                    style: TextStyle(
                                      fontSize: 12 * scaleFactor,
                                      color: textColor.withOpacity(0.6),
                                      letterSpacing: 3,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        );
      },
    );
  }

  Widget _buildWeather(Map<String, dynamic> item) {
    final scaleFactor = widget.weatherClockScale.clamp(0.7, 1.5);
    final textColor = widget.weatherClockTextColor;

    final temp = item['temperature']?.toString() ?? '--';
    final condition = item['condition']?.toString() ?? 'Clear';
    final location = item['location']?.toString() ?? 'Current conditions';

    return Container(
      width: double.infinity,
      height: double.infinity,
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: Alignment.topCenter,
          colors: [const Color(0x2238BDF8), Colors.transparent],
          radius: 0.4,
        ),
      ),
      child: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFF0F172A), Color(0xFF111827)],
          ),
        ),
        padding: EdgeInsets.all(20 * scaleFactor),
        child: LayoutBuilder(
          builder: (context, constraints) {
            return SingleChildScrollView(
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: constraints.maxHeight),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'WEATHER ☀️',
                          style: TextStyle(
                            fontSize: 10 * scaleFactor,
                            letterSpacing: 4.5,
                            color: textColor.withOpacity(0.85),
                          ),
                        ),
                        SizedBox(height: 8 * scaleFactor),
                        Text(
                          location,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 14 * scaleFactor,
                            color: textColor.withOpacity(0.7),
                          ),
                        ),
                      ],
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(
                          width: double.infinity,
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerLeft,
                            child: Text(
                              '$temp°',
                              style: TextStyle(
                                fontSize: 80 * scaleFactor,
                                fontWeight: FontWeight.w900,
                                color: textColor,
                                letterSpacing: -2,
                              ),
                            ),
                          ),
                        ),
                        SizedBox(height: 12 * scaleFactor),
                        Text(
                          '☀️ $condition',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 18 * scaleFactor,
                            fontWeight: FontWeight.w600,
                            color: textColor.withOpacity(0.9),
                          ),
                        ),
                        SizedBox(height: 12 * scaleFactor),
                        Wrap(
                          spacing: 8 * scaleFactor,
                          runSpacing: 8 * scaleFactor,
                          children: [
                            _buildWeatherChip(
                              'H ${item['high'] ?? '--'}°',
                              textColor,
                              scaleFactor,
                            ),
                            _buildWeatherChip(
                              'L ${item['low'] ?? '--'}°',
                              textColor,
                              scaleFactor,
                            ),
                            if (item['humidity'] != null)
                              _buildWeatherChip(
                                'Humidity ${item['humidity']}%',
                                textColor,
                                scaleFactor,
                              ),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildWeatherChip(String text, Color textColor, double scaleFactor) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: 12 * scaleFactor,
        vertical: 6 * scaleFactor,
      ),
      decoration: BoxDecoration(
        color: textColor.withOpacity(0.05),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: textColor.withOpacity(0.2)),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: textColor.withOpacity(0.7),
          fontSize: 12 * scaleFactor,
          letterSpacing: 2,
        ),
      ),
    );
  }

  Widget _buildText(Map<String, dynamic> item) {
    final textColor = widget.weatherClockTextColor;
    return Container(
      width: double.infinity,
      height: double.infinity,
      color: Colors.black,
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Text(
            item['content']?.toString() ?? item['text']?.toString() ?? '',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 24 * widget.weatherClockScale.clamp(0.7, 1.5),
              fontWeight: FontWeight.bold,
              color: textColor,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildYoutube(Map<String, dynamic> item) {
    final videoId = _getYoutubeId(item['url']?.toString() ?? '');
    if (videoId == null) return const SizedBox();

    if (kIsWeb) {
      return Container(
        width: double.infinity,
        height: double.infinity,
        color: Colors.black,
        padding: const EdgeInsets.all(20),
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.play_circle_fill, color: Colors.white54, size: 72),
              const SizedBox(height: 16),
              Text(
                item['title']?.toString() ?? 'YouTube video',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Web preview uses a fallback. Native Android playback uses the full player.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white.withOpacity(0.7),
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      );
    }

    if (youtubeController == null || youtubeController!.initialVideoId != videoId) {
      youtubeController?.dispose();
      _youtubeCompletionHandled = false;
      youtubeController = YoutubePlayerController(
        initialVideoId: videoId,
        flags: YoutubePlayerFlags(
          autoPlay: true,
          mute: isMuted,
          hideControls: true,
          controlsVisibleAtStart: false,
          disableDragSeek: true,
        ),
      );
      MediaSlot._claimAudioFocus(this);
      _applyMuteState();
      youtubeController!.addListener(() {
        final state = youtubeController!.value.playerState;
        if (state == PlayerState.ended && !_youtubeCompletionHandled) {
          _youtubeCompletionHandled = true;
          _handleMediaCompletion(() {
            youtubeController?.seekTo(Duration.zero);
            youtubeController?.play();
          });
        } else if (state != PlayerState.ended) {
          _youtubeCompletionHandled = false;
        }
      });
    } else {
      final state = youtubeController!.value.playerState;
      if (state == PlayerState.ended) {
        youtubeController!.seekTo(Duration.zero);
        youtubeController!.play();
      } else if (!youtubeController!.value.isPlaying) {
        youtubeController!.play();
      }
    }

    return YoutubePlayer(
      controller: youtubeController!,
      showVideoProgressIndicator: false,
      onReady: () {
        youtubeController?.play();
        _showPlaybackControlsTemporarily();
      },
    );
  }

  Widget _buildVideo(Map<String, dynamic> item) {
    final url = _resolveUrl(item);
    if (url.isEmpty) return const SizedBox();

    final mediaId = item['media_id']?.toString();
    final sourceKey = (mediaId != null && mediaId.isNotEmpty) ? 'media:$mediaId' : 'url:$url';

    if (videoController == null || _activeVideoSourceKey != sourceKey) {
      videoController?.dispose();
      videoError = null;
      _videoCompletionHandled = false;
      _activeVideoSourceKey = sourceKey;
      videoController = VideoPlayerController.networkUrl(Uri.parse(url))
        ..initialize().then((_) {
          if (mounted) setState(() {});
          MediaSlot._claimAudioFocus(this);
          videoController!.setLooping(widget.items.length == 1);
          videoController!.setVolume(isMuted ? 0.0 : 1.0);
          videoController!.play();
          _showPlaybackControlsTemporarily();
          videoController!.addListener(() {
            if (videoController!.value.hasError) {
              final errorDescription = videoController!.value.errorDescription ?? 'Unable to play video';
              if (_isLikelyEndOfStreamError(errorDescription)) {
                if (widget.items.length > 1) {
                  if (!_videoCompletionHandled) {
                    _videoCompletionHandled = true;
                    _handleMediaCompletion(() {
                      videoController?.seekTo(Duration.zero);
                      videoController?.play();
                    });
                  }
                } else {
                  _restartCurrentVideo();
                }
                return;
              }

              if (mounted) {
                setState(() {
                  videoError = errorDescription;
                });
              }
              return;
            }
            final v = videoController!.value;
            final ended = _isVideoPlaybackCompleted(v);
            if (ended && !_videoCompletionHandled) {
              _videoCompletionHandled = true;
              if (widget.items.length > 1) {
                _handleMediaCompletion(() {
                  videoController?.seekTo(Duration.zero);
                  videoController?.play();
                });
              } else {
                _restartCurrentVideo();
              }
            } else if (!ended) {
              _videoCompletionHandled = false;
            }
          });
        }).catchError((error) {
          if (mounted) {
            setState(() {
              videoError = error.toString();
            });
          }
        });
    } else {
      final v = videoController!.value;
      if (v.isInitialized && !v.isPlaying) {
        final ended = _isVideoPlaybackCompleted(v);
        if (ended) {
          if (widget.items.length > 1) {
            unawaited(videoController!.seekTo(Duration.zero).then((_) => videoController!.play()));
          } else {
            _restartCurrentVideo();
          }
        }
      }
    }

    if (videoController == null || !videoController!.value.isInitialized) {
      return Center(
        child: videoError == null
            ? const CircularProgressIndicator()
            : Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            videoError!,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white70, fontSize: 14),
          ),
        ),
      );
    }

    return Center(
      child: AspectRatio(
        aspectRatio: videoController!.value.aspectRatio == 0
            ? 16 / 9
            : videoController!.value.aspectRatio,
        child: VideoPlayer(videoController!),
      ),
    );
  }

  Widget _buildBookings(Map<String, dynamic> item) {
    final itemType = (item['type'] ?? '').toString().toLowerCase();
    var entries = (item['entries'] as List<dynamic>?) ??
        (item['items'] as List<dynamic>?) ??
        (item['bookings'] as List<dynamic>?) ??
        const [];

    if (entries.isEmpty) {
      if (itemType == 'queue') {
        entries = widget.queuePreview.isNotEmpty
            ? widget.queuePreview
            : widget.liveQueue;
      } else {
        entries = widget.todayBookingsPreview.isNotEmpty
            ? widget.todayBookingsPreview
            : (widget.queuePreview.isNotEmpty
                ? widget.queuePreview
                : widget.liveQueue);
      }
    }

    return Container(
      width: double.infinity,
      height: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFFF8FAFC), Color(0xFFEEF2FF)],
        ),
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'QUEUE',
                    style: TextStyle(
                      fontSize: 10,
                      letterSpacing: 4.5,
                      color: Color(0xFF6B7280),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    item['title']?.toString() ?? "Today's bookings",
                    style: const TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.w900,
                      color: Color(0xFF111827),
                    ),
                  ),
                ],
              ),
              const Text(
                'LIVE BOARD',
                style: TextStyle(
                  fontSize: 12,
                  letterSpacing: 2,
                  color: Color(0xFF6B7280),
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          Expanded(
            child: entries.isEmpty
                ? Container(
              decoration: BoxDecoration(
                border: Border.all(
                  color: const Color(0xFFCBD5E1),
                  style: BorderStyle.solid,
                ),
                borderRadius: BorderRadius.circular(16),
                color: Colors.white,
              ),
              padding: const EdgeInsets.all(16),
              child: const Center(
                child: Text(
                  'No bookings yet.',
                  style: TextStyle(color: Color(0xFF6B7280)),
                ),
              ),
            )
                : ListView.builder(
              itemCount: entries.length.clamp(0, 4),
              itemBuilder: (context, index) {
                final entry = entries[index] as Map<String, dynamic>;
                return Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Colors.white),
                    boxShadow: [
                      BoxShadow(
                        color: const Color(0xFF0F172A).withOpacity(0.05),
                        blurRadius: 30,
                        offset: const Offset(0, 12),
                      ),
                    ],
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'TOKEN ${entry['token'] ?? index + 1}',
                              style: const TextStyle(
                                fontSize: 10,
                                letterSpacing: 3.2,
                                color: Color(0xFF94A3B8),
                              ),
                            ),
                            Text(
                              entry['patient_name']?.toString() ??
                                  entry['service_name']?.toString() ?? 'Booking',
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w600,
                                color: Color(0xFF111827),
                              ),
                            ),
                            Text(
                              entry['service_type']?.toString() ??
                                  entry['service_name']?.toString() ?? 'Appointment',
                              style: const TextStyle(
                                color: Color(0xFF6B7280),
                              ),
                            ),
                          ],
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            entry['assigned_time']?.toString() ??
                                entry['preferred_time']?.toString() ??
                                '${entry['wait_after_mins'] ?? 0} min',
                            style: const TextStyle(
                              fontSize: 28,
                              fontWeight: FontWeight.w900,
                              color: Color(0xFF111827),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF8FAFC),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: const Color(0xFFE2E8F0)),
                            ),
                            child: const Text(
                              'SCHEDULED',
                              style: TextStyle(
                                fontSize: 10,
                                letterSpacing: 3.5,
                                color: Color(0xFF64748B),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNotices(Map<String, dynamic> item) {
    final notices = (item['items'] as List<dynamic>?) ??
      (item['notices'] as List<dynamic>?) ??
      widget.notices;

    return Container(
      width: double.infinity,
      height: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFF111827), Color(0xFF0F172A)],
        ),
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            (item['title'] ?? 'Notices').toString().toUpperCase(),
            style: TextStyle(
              fontSize: 10,
              letterSpacing: 4.5,
              color: Colors.white.withOpacity(0.45),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Announcements and updates',
            style: TextStyle(
              fontSize: 14,
              color: Colors.white.withOpacity(0.7),
            ),
          ),
          const SizedBox(height: 20),
          Expanded(
            child: notices.isEmpty
                ? Container(
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white.withOpacity(0.15)),
                borderRadius: BorderRadius.circular(16),
                color: Colors.white.withOpacity(0.05),
              ),
              padding: const EdgeInsets.all(16),
              child: Center(
                child: Text(
                  'No notices yet.',
                  style: TextStyle(
                    color: Colors.white.withOpacity(0.6),
                  ),
                ),
              ),
            )
                : ListView.builder(
              itemCount: notices.length.clamp(0, 4),
              itemBuilder: (context, index) {
                final notice = notices[index] as Map<String, dynamic>;
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.05),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Colors.white10),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        notice['title']?.toString() ?? 'Notice',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        notice['body']?.toString() ??
                            notice['text']?.toString() ?? '',
                        style: TextStyle(
                          color: Colors.white.withOpacity(0.7),
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMedia(Map<String, dynamic> item) {
    final url = _resolveUrl(item);
    if (url.isEmpty) return Container(color: Colors.black);

    if (_isImage(url)) {
      return CachedNetworkImage(
        imageUrl: url,
        fit: _getMediaFit(),
        placeholder: (context, url) => Container(
          color: Colors.black,
          child: const Center(child: CircularProgressIndicator()),
        ),
        errorWidget: (context, url, error) => Container(
          color: Colors.black,
          child: const Center(
            child: Icon(Icons.broken_image, color: Colors.white24, size: 48),
          ),
        ),
      );
    }

    return Container(color: Colors.black);
  }

  String _resolveUrl(Map<String, dynamic> item) {
    final candidate = item['url']?.toString() ??
        item['image_url']?.toString() ??
        item['public_url']?.toString() ??
        item['media_url']?.toString() ??
        (item['media_id'] != null ? '/api/media/${item['media_id']}' : '');

    if (candidate.isEmpty) return '';
    if (candidate.startsWith('http://') || candidate.startsWith('https://') ||
        candidate.startsWith('data:')) {
      return candidate;
    }

    final base = 'https://rpsignage.com';
    if (candidate.startsWith('/')) return '$base$candidate';
    return '$base/$candidate';
  }

  bool _isImage(String url) {
    final lowerUrl = url.toLowerCase();
    return lowerUrl.endsWith('.png') ||
        lowerUrl.endsWith('.jpg') ||
        lowerUrl.endsWith('.jpeg') ||
        lowerUrl.endsWith('.webp') ||
        lowerUrl.endsWith('.gif') ||
        lowerUrl.endsWith('.bmp') ||
        lowerUrl.endsWith('.svg') ||
        itemContainsImageType();
  }

  bool _isVideoUrl(String url) {
    final lowerUrl = url.toLowerCase();
    return lowerUrl.endsWith('.mp4') ||
        lowerUrl.endsWith('.mov') ||
        lowerUrl.endsWith('.m4v') ||
        lowerUrl.endsWith('.webm') ||
        lowerUrl.endsWith('.mkv');
  }

  bool _isVideoContentType(Map<String, dynamic> item) {
    final contentType = item['content_type']?.toString().toLowerCase() ?? '';
    return contentType.startsWith('video/');
  }

  bool itemContainsImageType() {
    if (widget.items.isEmpty || currentIndex >= widget.items.length) return false;
    final item = widget.items[currentIndex];
    final contentType = item['content_type']?.toString() ?? '';
    return contentType.startsWith('image/');
  }

  String? _getYoutubeId(String url) {
    final regex = RegExp(r'(?:youtube\.com/watch\?v=|youtu\.be/)([\w-]+)');
    final match = regex.firstMatch(url);
    return match?.group(1);
  }

  String _getWeekday(int day) {
    switch (day) {
      case 1: return 'Monday';
      case 2: return 'Tuesday';
      case 3: return 'Wednesday';
      case 4: return 'Thursday';
      case 5: return 'Friday';
      case 6: return 'Saturday';
      case 7: return 'Sunday';
      default: return '';
    }
  }

  String _getMonth(int month) {
    switch (month) {
      case 1: return 'Jan';
      case 2: return 'Feb';
      case 3: return 'Mar';
      case 4: return 'Apr';
      case 5: return 'May';
      case 6: return 'Jun';
      case 7: return 'Jul';
      case 8: return 'Aug';
      case 9: return 'Sep';
      case 10: return 'Oct';
      case 11: return 'Nov';
      case 12: return 'Dec';
      default: return '';
    }
  }
}

// Ticker Slot Widget (same as before)
class TickerSlot extends StatelessWidget {
  final List<Map<String, dynamic>> items;
  final String label;
  final double tickerSpeed;
  final Color textColor;
  final Color backgroundColor;

  const TickerSlot({
    super.key,
    required this.items,
    required this.label,
    this.tickerSpeed = 50,
    this.textColor = Colors.white,
    this.backgroundColor = Colors.black,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final scale = max(0.65, min(1.0, min(constraints.maxWidth / 420, constraints.maxHeight / 90)));

        if (items.isEmpty) {
          return Container(
            color: backgroundColor,
            child: Center(
              child: Text(
                label.toUpperCase(),
                style: TextStyle(
                  color: textColor.withOpacity(0.3),
                  fontSize: 12 * scale,
                  fontFamily: 'monospace',
                  letterSpacing: 3,
                ),
              ),
            ),
          );
        }

        final tickerTexts = items.map((item) {
          return item['text']?.toString() ??
              item['title']?.toString() ??
              item['message']?.toString() ?? '';
        }).where((text) => text.isNotEmpty).toList();

        if (tickerTexts.isEmpty) {
          return Container(color: backgroundColor);
        }

        final tickerText = tickerTexts.join('  •  ');

        return ClipRect(
          child: FittedBox(
            fit: BoxFit.contain,
            alignment: Alignment.centerLeft,
            child: SizedBox(
              width: constraints.maxWidth,
              height: constraints.maxHeight,
              child: Container(
                color: backgroundColor,
                child: Center(
                  child: Marquee(
                    text: tickerText,
                    style: TextStyle(
                      color: textColor,
                      fontWeight: FontWeight.w600,
                      fontSize: 14 * scale,
                    ),
                    scrollAxis: Axis.horizontal,
                    crossAxisAlignment: CrossAxisAlignment.center,
                    blankSpace: 100 * scale,
                    velocity: tickerSpeed * scale,
                    pauseAfterRound: const Duration(seconds: 0),
                    startPadding: 10 * scale,
                    accelerationDuration: const Duration(seconds: 1),
                    accelerationCurve: Curves.linear,
                    decelerationDuration: const Duration(milliseconds: 500),
                    decelerationCurve: Curves.easeOut,
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

// Queue Board Widget (same as before)
class QueueBoard extends StatelessWidget {
  final String? deviceName;
  final List<dynamic> queuePreview;
  final List<dynamic> notices;

  const QueueBoard({
    super.key,
    this.deviceName,
    required this.queuePreview,
    required this.notices,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final scale = max(0.58, min(1.0, min(constraints.maxWidth / 480, constraints.maxHeight / 720)));

        if (queuePreview.isEmpty) {
          return Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [Colors.pink, Colors.deepOrange],
              ),
            ),
            child: Center(
              child: Text(
                'NO QUEUE',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 24 * scale,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          );
        }

        final currentToken = queuePreview.first as Map<String, dynamic>;
        final nextTokens = queuePreview.length > 1
            ? queuePreview.sublist(1, min(3, queuePreview.length))
            : [];
        final currentTokenLabel = _readTokenLabel(currentToken);
        final currentServiceLabel = _readServiceLabel(currentToken);
        final currentPatientLabel = _readPatientLabel(currentToken);

        return ClipRect(
          child: FittedBox(
            fit: BoxFit.contain,
            alignment: Alignment.topLeft,
            child: SizedBox(
              width: constraints.maxWidth,
              height: constraints.maxHeight,
              child: Container(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFFEC4899), Color(0xFFFB7185), Color(0xFFF97316)],
                  ),
                ),
                child: Column(
                  children: [
              Container(
                width: double.infinity,
                padding: EdgeInsets.symmetric(vertical: 14 * scale),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.15),
                  border: Border(
                    bottom: BorderSide(color: Colors.white.withOpacity(0.3), width: 2 * scale),
                  ),
                ),
                child: Center(
                  child: Text(
                    '🔴 LIVE QUEUE STATUS',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w900,
                      fontSize: 16 * scale,
                      letterSpacing: 4,
                    ),
                  ),
                ),
              ),
              Expanded(
                child: Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16 * scale, vertical: 14 * scale),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        '⚡ CURRENTLY SERVING',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 11 * scale,
                          fontWeight: FontWeight.w800,
                          color: Colors.white.withOpacity(0.92),
                          letterSpacing: 2.2,
                        ),
                      ),
                      SizedBox(height: 10 * scale),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text(
                          currentTokenLabel,
                          style: TextStyle(
                            fontSize: 132 * scale,
                            fontWeight: FontWeight.w900,
                            color: Colors.white,
                            height: 0.92,
                            shadows: const [
                              Shadow(color: Colors.black26, offset: Offset(4, 4), blurRadius: 12),
                            ],
                          ),
                        ),
                      ),
                      SizedBox(height: 10 * scale),
                      Text(
                        currentPatientLabel,
                        textAlign: TextAlign.center,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 24 * scale,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                        ),
                      ),
                      SizedBox(height: 8 * scale),
                      Text(
                        currentServiceLabel,
                        textAlign: TextAlign.center,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 13 * scale,
                          fontWeight: FontWeight.w600,
                          color: Colors.white.withOpacity(0.85),
                          letterSpacing: 0.6,
                        ),
                      ),
                      if (nextTokens.isNotEmpty) ...[
                        SizedBox(height: 14 * scale),
                        Container(
                          width: double.infinity,
                          padding: EdgeInsets.all(10 * scale),
                          decoration: BoxDecoration(
                            color: Colors.black.withOpacity(0.22),
                            borderRadius: BorderRadius.circular(12 * scale),
                            border: Border.all(color: Colors.white.withOpacity(0.28)),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Center(
                                child: Text(
                                  '⏩ NEXT IN QUEUE',
                                  style: TextStyle(
                                    color: Colors.white.withOpacity(0.72),
                                    fontSize: 9.5 * scale,
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: 1.8,
                                  ),
                                ),
                              ),
                              SizedBox(height: 8 * scale),
                              ...nextTokens.map((token) {
                                final entry = token as Map<String, dynamic>;
                                final nextTokenLabel = _readTokenLabel(entry);
                                final nextPatientLabel = _readPatientLabel(entry);
                                final nextServiceLabel = _readServiceLabel(entry);
                                final waitLabel = _readWaitLabel(entry);

                                return Container(
                                  width: double.infinity,
                                  margin: EdgeInsets.only(bottom: 8 * scale),
                                  padding: EdgeInsets.symmetric(horizontal: 10 * scale, vertical: 8 * scale),
                                  decoration: BoxDecoration(
                                    color: Colors.white.withOpacity(0.14),
                                    borderRadius: BorderRadius.circular(10 * scale),
                                    border: Border.all(color: Colors.white.withOpacity(0.24)),
                                  ),
                                  child: Row(
                                    children: [
                                      Container(
                                        constraints: BoxConstraints(minWidth: 44 * scale),
                                        child: Text(
                                          nextTokenLabel,
                                          textAlign: TextAlign.center,
                                          style: TextStyle(
                                            color: Colors.white,
                                            fontSize: 28 * scale,
                                            fontWeight: FontWeight.w900,
                                          ),
                                        ),
                                      ),
                                      Container(
                                        margin: EdgeInsets.symmetric(horizontal: 10 * scale),
                                        width: 1,
                                        height: 34 * scale,
                                        color: Colors.white.withOpacity(0.35),
                                      ),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              nextPatientLabel,
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: TextStyle(
                                                color: Colors.white,
                                                fontSize: 13 * scale,
                                                fontWeight: FontWeight.w700,
                                              ),
                                            ),
                                            SizedBox(height: 2 * scale),
                                            Text(
                                              nextServiceLabel,
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: TextStyle(
                                                color: Colors.white.withOpacity(0.68),
                                                fontSize: 10 * scale,
                                                fontWeight: FontWeight.w600,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                      if (waitLabel != null)
                                        Container(
                                          margin: EdgeInsets.only(left: 8 * scale),
                                          padding: EdgeInsets.symmetric(horizontal: 6 * scale, vertical: 4 * scale),
                                          decoration: BoxDecoration(
                                            color: Colors.white.withOpacity(0.14),
                                            borderRadius: BorderRadius.circular(6 * scale),
                                          ),
                                          child: Text(
                                            waitLabel,
                                            style: TextStyle(
                                              color: Colors.white,
                                              fontSize: 9 * scale,
                                              fontWeight: FontWeight.w800,
                                            ),
                                          ),
                                        ),
                                    ],
                                  ),
                                );
                              }),
                            ],
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              if (notices.isNotEmpty && notices.first != null)
                Container(
                  width: double.infinity,
                  padding: EdgeInsets.symmetric(vertical: 12 * scale, horizontal: 16 * scale),
                  decoration: BoxDecoration(
                    color: Colors.black.withOpacity(0.3),
                    border: Border(top: BorderSide(color: Colors.white.withOpacity(0.3), width: 2 * scale)),
                  ),
                  child: Text(
                    '📢 ${notices.first['title'] ?? notices.first['body'] ?? 'QUEUE UPDATES AVAILABLE'}',
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                      fontSize: 12 * scale,
                    ),
                  ),
                ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  String _readTokenLabel(Map<String, dynamic> entry) {
    final tokenValue = entry['token'] ??
        entry['token_no'] ??
        entry['token_number'] ??
        entry['queue_token'] ??
        entry['ticket_no'] ??
        entry['ticket_number'];
    final tokenText = tokenValue?.toString().trim() ?? '';
    return tokenText.isNotEmpty ? tokenText : '—';
  }

  String _readServiceLabel(Map<String, dynamic> entry) {
    final serviceValue = entry['service_name'] ??
        entry['service_type'] ??
        entry['name'];
    final serviceText = serviceValue?.toString().trim() ?? '';
    return serviceText.isNotEmpty ? serviceText : '→ PLEASE PROCEED TO COUNTER ←';
  }

  String _readPatientLabel(Map<String, dynamic> entry) {
    final patientValue = entry['patient_name'] ??
        entry['name'] ??
        entry['service_name'];
    final patientText = patientValue?.toString().trim() ?? '';
    return patientText.isNotEmpty ? patientText : 'GUEST';
  }

  String? _readWaitLabel(Map<String, dynamic> entry) {
    final waitValue = entry['wait_after_mins'];
    if (waitValue == null) return null;
    final waitText = waitValue.toString().trim();
    if (waitText.isEmpty || waitText == '0') return null;
    return '${waitText}m';
  }
}

// Auto Widget Zone (same as before)
class AutoWidgetZone extends StatelessWidget {
  final Map<String, dynamic> zone;
  final List<dynamic> queuePreview;
  final Map<String, dynamic>? payload;
  final Map<String, dynamic>? providerData;
  final dynamic weatherData;
  final double canvasWidth;
  final double canvasHeight;
  final double weatherScaleFactor;
  final Color weatherClockTextColor;

  const AutoWidgetZone({
    super.key,
    required this.zone,
    required this.queuePreview,
    this.payload,
    this.providerData,
    this.weatherData,
    required this.canvasWidth,
    required this.canvasHeight,
    this.weatherScaleFactor = 1.0,
    this.weatherClockTextColor = Colors.white,
  });

  @override
  Widget build(BuildContext context) {
    final role = (zone['role'] ?? '').toString().toLowerCase();

    return LayoutBuilder(
      builder: (context, constraints) {
        final scale = max(0.38, min(1.0, min(constraints.maxWidth / 520, constraints.maxHeight / 320)));
        final child = switch (role) {
          'header' => _buildHeader(scale * weatherScaleFactor.clamp(0.7, 1.5)),
          'weather' => _buildWeather(scale * weatherScaleFactor.clamp(0.7, 1.5)),
          'bookings' => _buildBookings(scale),
          _ => const SizedBox(),
        };

        return ClipRect(
          child: FittedBox(
            fit: BoxFit.contain,
            alignment: Alignment.topLeft,
            child: SizedBox(
              width: constraints.maxWidth,
              height: constraints.maxHeight,
              child: child,
            ),
          ),
        );
      },
    );
  }

  Widget _buildHeader(double scale) {
    final now = DateTime.now();
    final date = '${_getWeekday(now.weekday)}, ${_getMonth(now.month)} ${now.day}';
    final time = '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';

    return Container(
      width: double.infinity,
      height: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF111827), Color(0xFF0F172A)],
        ),
      ),
      padding: EdgeInsets.symmetric(horizontal: 14 * scale, vertical: 10 * scale),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'TODAY',
                  style: TextStyle(
                    fontSize: 10 * scale,
                    letterSpacing: 4.5,
                    color: weatherClockTextColor.withOpacity(0.45),
                  ),
                ),
                SizedBox(height: 4 * scale),
                SizedBox(
                  width: double.infinity,
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Text(
                      date,
                      style: TextStyle(
                        fontSize: 28 * scale,
                        fontWeight: FontWeight.w900,
                        color: weatherClockTextColor,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(width: 10 * scale),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  'LOCAL TIME',
                  style: TextStyle(
                    fontSize: 10 * scale,
                    letterSpacing: 4.5,
                    color: weatherClockTextColor.withOpacity(0.45),
                  ),
                ),
                SizedBox(height: 4 * scale),
                SizedBox(
                  width: double.infinity,
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerRight,
                    child: Text(
                      time,
                      style: TextStyle(
                        fontSize: 36 * scale,
                        fontWeight: FontWeight.w900,
                        color: weatherClockTextColor,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWeather(double scale) {
    final weather = (weatherData as Map<String, dynamic>?) ?? {};
    final temp = weather['temperature']?.toString() ?? '--';
    final condition = weather['condition']?.toString() ?? 'Weather sync pending';
    final high = weather['high']?.toString() ?? '--';
    final low = weather['low']?.toString() ?? '--';

    return Container(
      width: double.infinity,
      height: double.infinity,
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: Alignment.topCenter,
          colors: [const Color(0x2238BDF8), Colors.transparent],
          radius: 0.4,
        ),
      ),
      child: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFF0F172A), Color(0xFF111827)],
          ),
        ),
        padding: EdgeInsets.all(20 * scale),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'WEATHER ☀️',
                  style: TextStyle(
                    fontSize: 10 * scale,
                    letterSpacing: 4.5,
                    color: weatherClockTextColor.withOpacity(0.85),
                  ),
                ),
                SizedBox(height: 8 * scale),
                Text(
                  weather['location']?.toString() ?? 'Current conditions',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14 * scale,
                    color: weatherClockTextColor.withOpacity(0.7),
                  ),
                ),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    '$temp°',
                    style: TextStyle(
                      fontSize: 80 * scale,
                      fontWeight: FontWeight.w900,
                      color: weatherClockTextColor,
                      letterSpacing: -2,
                    ),
                  ),
                ),
                SizedBox(height: 12 * scale),
                Text(
                  '☀️ $condition',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 18 * scale,
                    fontWeight: FontWeight.w600,
                    color: weatherClockTextColor.withOpacity(0.9),
                  ),
                ),
                SizedBox(height: 12 * scale),
                Wrap(
                  spacing: 8 * scale,
                  runSpacing: 8 * scale,
                  children: [
                    _buildChip('H $high°', scale, weatherClockTextColor),
                    _buildChip('L $low°', scale, weatherClockTextColor),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBookings(double scale) {
    final rawEntries = (payload?['today_bookings_preview'] as List<dynamic>?) ?? queuePreview;
    final entries = rawEntries.map((item) {
      final i = item as Map<String, dynamic>;
      return {
        'token': i['token'] ?? i['token_no'] ?? i['token_number'] ?? i['queue_token'] ?? i['ticket_no'] ?? i['ticket_number'],
        'name': i['patient_name'] ?? i['service_name'] ?? i['name'] ?? 'Booking',
        'time': i['assigned_time'] ?? i['preferred_time'] ?? '${i['wait_after_mins'] ?? 0} min',
        'service': i['service_type'] ?? i['service_name'] ?? i['title'] ?? 'Appointment',
      };
    }).toList();

    return Container(
      width: double.infinity,
      height: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0xFFF8FAFC), Color(0xFFEEF2FF)],
        ),
      ),
      padding: EdgeInsets.all(20 * scale),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'QUEUE',
                    style: TextStyle(
                      fontSize: 10 * scale,
                      letterSpacing: 4,
                      color: const Color(0xFF94A3B8),
                    ),
                  ),
                  SizedBox(height: 4 * scale),
                  const Text(
                    "Today's bookings",
                    style: TextStyle(
                    fontSize: 24,
                      fontWeight: FontWeight.w900,
                      color: Color(0xFF0F172A),
                    ),
                  ),
                ],
              ),
              const Text(
                'LIVE BOARD',
                style: TextStyle(
                  fontSize: 10,
                  letterSpacing: 3.5,
                  color: Color(0xFF94A3B8),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Expanded(
            child: entries.isEmpty
                ? Container(
              decoration: BoxDecoration(
                border: Border.all(color: const Color(0xFFCBD5E1)),
                borderRadius: BorderRadius.circular(16),
                color: const Color(0xFFF8FAFC),
              ),
              padding: EdgeInsets.all(16 * scale),
              child: const Center(
                child: Text(
                  'No bookings yet.',
                  style: TextStyle(color: Color(0xFF64748B)),
                ),
              ),
            )
                : ListView.builder(
              itemCount: entries.length.clamp(0, 4),
              itemBuilder: (context, index) {
                final entry = entries[index];
                return Container(
                  margin: EdgeInsets.only(bottom: 12 * scale),
                  padding: EdgeInsets.all(16 * scale),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                    boxShadow: [
                      BoxShadow(
                        color: const Color(0xFF0F172A).withOpacity(0.05),
                        blurRadius: 30,
                        offset: const Offset(0, 14),
                      ),
                    ],
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 56 * scale,
                        height: 56 * scale,
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Color(0xFF111827), Color(0xFF334155)],
                          ),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Center(
                          child: Text(
                            entry['token']?.toString() ??
                                entry['name'].toString()[0].toUpperCase(),
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 16,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ),
                      SizedBox(width: 16 * scale),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'TOKEN ${entry['token'] ?? index + 1}',
                              style: const TextStyle(
                                fontSize: 10,
                                letterSpacing: 3.2,
                                color: Color(0xFF94A3B8),
                              ),
                            ),
                            Text(
                              entry['name'].toString(),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 18 * scale,
                                fontWeight: FontWeight.w600,
                                color: Color(0xFF0F172A),
                              ),
                            ),
                            Text(
                              entry['service'].toString(),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Color(0xFF64748B),
                              ),
                            ),
                          ],
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF8FAFC),
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: const Color(0xFFE2E8F0)),
                            ),
                            child: const Text(
                              'SCHEDULED',
                              style: TextStyle(
                                fontSize: 10,
                                letterSpacing: 3.5,
                                color: Color(0xFF64748B),
                              ),
                            ),
                          ),
                          SizedBox(height: 8 * scale),
                          Text(
                            entry['time'].toString(),
                            style: TextStyle(
                              fontSize: 24 * scale,
                              fontWeight: FontWeight.w900,
                              color: Color(0xFF0F172A),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildChip(String text, double scale, Color textColor) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 12 * scale, vertical: 6 * scale),
      decoration: BoxDecoration(
        color: textColor.withOpacity(0.05),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: textColor.withOpacity(0.2)),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 12 * scale,
          color: textColor.withOpacity(0.7),
          letterSpacing: 2,
        ),
      ),
    );
  }

  String _getWeekday(int day) {
    switch (day) {
      case 1: return 'Monday';
      case 2: return 'Tuesday';
      case 3: return 'Wednesday';
      case 4: return 'Thursday';
      case 5: return 'Friday';
      case 6: return 'Saturday';
      case 7: return 'Sunday';
      default: return '';
    }
  }

  String _getMonth(int month) {
    switch (month) {
      case 1: return 'Jan';
      case 2: return 'Feb';
      case 3: return 'Mar';
      case 4: return 'Apr';
      case 5: return 'May';
      case 6: return 'Jun';
      case 7: return 'Jul';
      case 8: return 'Aug';
      case 9: return 'Sep';
      case 10: return 'Oct';
      case 11: return 'Nov';
      case 12: return 'Dec';
      default: return '';
    }
  }
}

// Custom AnimatedBuilder widget
class AnimatedBuilder extends AnimatedWidget {
  final Widget Function(BuildContext context, Widget? child) builder;
  final Widget? child;

  const AnimatedBuilder({
    super.key,
    required super.listenable,
    required this.builder,
    this.child,
  });

  @override
  Widget build(BuildContext context) {
    return builder(context, child);
  }
}