// lib/models/player_payload.dart
/**
class PlayerPayload {
  final String? deviceName;
  final String? clientName;
  final String? orientation;
  final double? brightness;
  final Map<String, List<PlayerMediaItem>> zones;
  final List<PlayerZoneDefinition> layoutZones;
  final Map<String, dynamic> raw;

  const PlayerPayload({
    required this.deviceName,
    required this.clientName,
    required this.orientation,
    required this.brightness,
    required this.zones,
    required this.layoutZones,
    required this.raw,
  });

  factory PlayerPayload.fromJson(Map<String, dynamic> json) {
    final zones = <String, List<PlayerMediaItem>>{};
    final rawZones = json['zones'];
    if (rawZones is Map) {
      rawZones.forEach((key, value) {
        final list = <PlayerMediaItem>[];
        if (value is List) {
          for (final entry in value) {
            if (entry is Map<String, dynamic>) {
              list.add(PlayerMediaItem.fromJson(entry, json));
            } else if (entry is Map) {
              list.add(PlayerMediaItem.fromJson(Map<String, dynamic>.from(entry), json));
            }
          }
        }
        zones[key.toString()] = list;
      });
    }

    final layoutZones = <PlayerZoneDefinition>[];
    final layout = json['template'] is Map<String, dynamic>
        ? json['template']['layout']
        : (json['layout'] is Map ? json['layout'] : null);
    final rawLayoutZones = layout is Map ? layout['zones'] : null;
    if (rawLayoutZones is List) {
      for (final entry in rawLayoutZones) {
        if (entry is Map<String, dynamic>) {
          layoutZones.add(PlayerZoneDefinition.fromJson(entry));
        } else if (entry is Map) {
          layoutZones.add(PlayerZoneDefinition.fromJson(Map<String, dynamic>.from(entry)));
        }
      }
    }

    return PlayerPayload(
      deviceName: _asString(json['device_name'] ?? json['deviceName']),
      clientName: _asString(json['client_name'] ?? json['clientName']),
      orientation: _asString(json['orientation']),
      brightness: _asDouble(json['brightness']),
      zones: zones,
      layoutZones: layoutZones,
      raw: json,
    );
  }

  List<PlayerZoneDefinition> get visibleZones => layoutZones.isEmpty
      ? zones.entries
      .map((entry) => PlayerZoneDefinition(id: entry.key, name: entry.key, role: entry.key))
      .toList()
      : layoutZones;
}

class PlayerZoneDefinition {
  final String id;
  final String? name;
  final String? role;
  final double? x;
  final double? y;
  final double? widthPx;
  final double? heightPx;
  final int? zIndex;

  const PlayerZoneDefinition({
    required this.id,
    this.name,
    this.role,
    this.x,
    this.y,
    this.widthPx,
    this.heightPx,
    this.zIndex,
  });

  factory PlayerZoneDefinition.fromJson(Map<String, dynamic> json) {
    return PlayerZoneDefinition(
      id: _asString(json['id']) ?? 'zone',
      name: _asString(json['name']),
      role: _asString(json['role']),
      x: _asDouble(json['x']),
      y: _asDouble(json['y']),
      widthPx: _asDouble(json['width_px'] ?? json['widthPx']),
      heightPx: _asDouble(json['height_px'] ?? json['heightPx']),
      zIndex: _asInt(json['z_index'] ?? json['zIndex']),
    );
  }
}

class PlayerMediaItem {
  final String? id;
  final String? name;
  final String? url;
  final String? contentType;
  final String? kind;
  final String? fit;
  final String? description;
  final Map<String, dynamic> raw;

  const PlayerMediaItem({
    required this.id,
    required this.name,
    required this.url,
    required this.contentType,
    required this.kind,
    required this.fit,
    required this.description,
    required this.raw,
  });

  factory PlayerMediaItem.fromJson(Map<String, dynamic> json, [Map<String, dynamic>? parentJson]) {
    String? url = _asString(json['url']);
    url ??= _asString(json['public_url']);
    url ??= _asString(json['image_url']);
    url ??= _asString(json['source_url']);
    url ??= _asString(json['media_url']);
    url ??= _asString(json['src']);

    return PlayerMediaItem(
      id: _asString(json['id'] ?? json['media_id']),
      name: _asString(json['name'] ?? json['title']),
      url: url,
      contentType: _asString(json['content_type'] ?? json['contentType']),
      kind: _asString(json['kind'] ?? json['type']),
      fit: _asString(json['fit']),
      description: _asString(json['description'] ?? json['body'] ?? json['text']),
      raw: json,
    );
  }

  bool get isImage {
    if (kind?.toLowerCase() == 'image') return true;
    if (contentType?.toLowerCase().startsWith('image/') == true) return true;
    final source = (url ?? '').toLowerCase();
    return source.endsWith('.png') ||
        source.endsWith('.jpg') ||
        source.endsWith('.jpeg') ||
        source.endsWith('.webp') ||
        source.endsWith('.gif') ||
        source.endsWith('.bmp') ||
        source.endsWith('.svg');
  }

  bool get isVideo {
    if (kind?.toLowerCase() == 'video') return true;
    if (contentType?.toLowerCase().startsWith('video/') == true) return true;
    final source = (url ?? '').toLowerCase();
    return source.endsWith('.mp4') ||
        source.endsWith('.mov') ||
        source.endsWith('.m4v') ||
        source.endsWith('.webm') ||
        source.endsWith('.avi') ||
        source.endsWith('.mkv');
  }
}

String? _asString(dynamic value) {
  if (value == null) return null;
  final text = value.toString().trim();
  return text.isEmpty ? null : text;
}

double? _asDouble(dynamic value) {
  if (value == null) return null;
  if (value is num) return value.toDouble();
  return double.tryParse(value.toString());
}

int? _asInt(dynamic value) {
  if (value == null) return null;
  if (value is num) return value.toInt();
  return int.tryParse(value.toString());
}






    import 'package:flutter/material.dart';
    import 'package:flutter/services.dart';
    import 'package:http/http.dart' as http;
    import 'dart:convert';
    import 'dart:async';
    import 'dart:math';
    import 'package:shared_preferences/shared_preferences.dart';
    import 'package:youtube_player_flutter/youtube_player_flutter.dart';
    import 'package:video_player/video_player.dart';
    import 'package:cached_network_image/cached_network_image.dart';
    import 'package:marquee/marquee.dart';
    import 'package:geolocator/geolocator.dart';
    import 'package:geocoding/geocoding.dart';
    import 'package:flutter/foundation.dart' show kIsWeb;
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
    // State variables
    bool showSplash = true;
    bool showPairing = false;
    String? currentPairCode;
    String pairingError = "";

    Map<String, dynamic>? payload;
    Map<String, dynamic>? providerData;
    Map<String, dynamic>? liveWeather;
    String weatherState = "idle";
    String errorMessage = "";

    List<String> hiddenZoneIds = [];
    bool fillBlankSpaces = true;
    bool customPlacementEnabled = false;
    Map<String, String> zonePlacements = {};
    Map<String, String> zoneMediaModes = {};
    String orientationOverride = "auto";
    bool menuOpen = false;

    Timer? pollTimer;
    Timer? providerTimer;
    Timer? weatherTimer;

    String apiBase = "http://10.18.51.60:8000";
    Size viewportSize = Size.zero;

    @override
    void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _updateViewportSize();
    _loadPreferences();
    }

    @override
    void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    pollTimer?.cancel();
    providerTimer?.cancel();
    weatherTimer?.cancel();
    super.dispose();
    }

    void _updateViewportSize() {
    // 1. Keep the mounted check for setState safety
    if (!mounted) return;

    // 2. Access the view via the PlatformDispatcher instead of View.of(context)
    // This avoids the "deactivated widget" error because it doesn't use the context
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

    @override
    void didChangeMetrics() {
    _updateViewportSize();
    }

    @override
    void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
    if (currentPairCode != null && !showPairing && !showSplash) {
    _poll();
    }
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
    showPairing = true;
    });
    }
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

    Future<void> _poll() async {
    if (currentPairCode == null) return;

    try {
    final response = await http.get(
    Uri.parse('$apiBase/api/public/player/$currentPairCode'),
    );

    if (response.statusCode == 200) {
    final data = json.decode(response.body);
    _safeSetState(() {
    payload = data;
    errorMessage = "";
    pairingError = "";
    });

    // Load preferences for this pair code
    await _loadZonePreferences();

    // Fetch provider data
    if (data['client_id'] != null) {
    _fetchProviderData(data['client_id'].toString());
    }

    // Check for weather zones
    _checkWeatherZones();
    } else if (response.statusCode == 404) {
    _safeSetState(() {
    pairingError = "Invalid pairing code. Please check and try again.";
    showPairing = true;
    currentPairCode = null;
    });
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('pairCode');
    } else {
    _safeSetState(() => errorMessage = "Could not load content");
    }
    } catch (e) {
    _safeSetState(() => errorMessage = "Connection error: ${e.toString()}");
    }

    // Poll every 60 seconds
    pollTimer?.cancel();
    pollTimer = Timer.periodic(const Duration(seconds: 60), (_) {
    if (currentPairCode != null && !showPairing && !showSplash) {
    _poll();
    }
    });
    }

    Future<void> _fetchProviderData(String clientId) async {
    try {
    final response = await http.get(
    Uri.parse('$apiBase/api/public/providers/$clientId'),
    );
    if (response.statusCode == 200) {
    _safeSetState(() => providerData = json.decode(response.body));
    }
    } catch (e) {
    // Handle error silently
    }

    // Refresh provider data every 20 seconds
    providerTimer?.cancel();
    providerTimer = Timer.periodic(const Duration(seconds: 20), (_) async {
    if (currentPairCode != null && !showPairing && !showSplash) {
    try {
    final response = await http.get(
    Uri.parse('$apiBase/api/public/providers/$clientId'),
    );
    if (response.statusCode == 200 && mounted) {
    setState(() => providerData = json.decode(response.body));
    }
    } catch (e) {
    // Handle error silently
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
    final data = json.decode(response.body);
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
    final data = json.decode(raw);
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
    });
    } catch (e) {
    // Handle JSON parse error
    }
    }

    // Load orientation preference
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
    // Legacy support
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
    setState(() => menuOpen = !menuOpen);
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

    @override
    Widget build(BuildContext context) {
    if (showSplash) {
    return const ModernSplashScreen();
    }

    if (showPairing) {
    return PairingScreen(
    onPair: _pairDevice,
    error: pairingError,
    );
    }

    if (errorMessage.isNotEmpty && payload == null) {
    return _buildErrorScreen();
    }

    if (payload == null) {
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
    final brightness = (payload?['brightness'] ?? 100).toDouble() / 100;

    final zoneDefs = _getZoneDefinitions();
    final visibleZones = zoneDefs
    .where((z) => !hiddenZoneIds.contains(z['id']))
    .toList();

    final hasContent = visibleZones.any((z) {
    final items = payload?['zones']?[z['id']] ?? [];
    return items.isNotEmpty;
    });

    // Calculate rotation
    final explicitRotation = _normalizeRotation(
    payload?['rotation'] ?? payload?['rotation_degrees'] ?? payload?['rotation_angle'] ?? payload?['rotate'] ?? 0
    );

    final isPortrait = viewportSize.height > viewportSize.width;
    final baseRotation = orientationOverride == 'portrait'
    ? 90
    : orientationOverride == 'landscape'
    ? 0
    : (isPortrait ? 90 : 0);

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

    return Scaffold(
    backgroundColor: Colors.black,
    body: Stack(
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

    // Menu button
    Positioned(
    top: 16,
    right: 16,
    child: _buildMenuButton(zoneDefs),
    ),
    ],
    ),
    );
    }

    int _normalizeRotation(dynamic value) {
    final num = int.tryParse(value?.toString() ?? '0') ?? 0;
    final normalized = ((num.round() / 90).round() * 90) % 360;
    if (normalized < 0) return normalized + 360;
    return [0, 90, 180, 270].contains(normalized) ? normalized : 0;
    }

    Matrix4 _getRotationMatrix(int rotation, double surfaceWidth, double surfaceHeight) {
    switch (rotation) {
    case 90:
    return Matrix4.identity()
    ..rotateZ(pi / 2)
    ..translate(0.0, -surfaceHeight);
    case 180:
    return Matrix4.identity()
    ..rotateZ(pi)
    ..translate(-surfaceWidth, -surfaceHeight);
    case 270:
    return Matrix4.identity()
    ..rotateZ(3 * pi / 2)
    ..translate(-surfaceWidth, 0.0);
    default:
    return Matrix4.identity();
    }
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
    onPressed: () => setState(() {
    showPairing = true;
    }),
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
    final shouldCompact = fillBlankSpaces && hiddenZoneIds.isNotEmpty;

    if (renderAsAbsolute && !shouldCompact) {
    return SizedBox.expand(
    child: _buildAbsoluteLayout(visibleZones, canvasWidth, canvasHeight),
    );
    }

    return SizedBox.expand(
    child: _buildGridLayout(visibleZones, canvasWidth, canvasHeight),
    );
    }

    Widget _buildAbsoluteLayout(
    List<Map<String, dynamic>> zones,
    double canvasWidth,
    double canvasHeight,
    ) {
    final viewportWidth = viewportSize.width > 0 ? viewportSize.width : canvasWidth;
    final viewportHeight = viewportSize.height > 0 ? viewportSize.height : canvasHeight;
    final scaleX = viewportWidth / canvasWidth;
    final scaleY = viewportHeight / canvasHeight;

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
    child: _buildZone(zone, items, canvasWidth, canvasHeight),
    );
    }).toList(),
    );
    }

    Widget _buildGridLayout(
    List<Map<String, dynamic>> zones,
    double canvasWidth,
    double canvasHeight,
    ) {
    if (zones.length == 1) {
    final zone = zones.first;
    final items = List<Map<String, dynamic>>.from(
    payload?['zones']?[zone['id']] ?? [],
    );
    return _buildZone(zone, items, canvasWidth, canvasHeight);
    }

    return Column(
    mainAxisSize: MainAxisSize.max,
    children: zones.map((zone) {
    final items = List<Map<String, dynamic>>.from(
    payload?['zones']?[zone['id']] ?? [],
    );
    return Expanded(
    child: _buildZone(zone, items, canvasWidth, canvasHeight),
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

    // Check zone type
    if (_isQueueZone(zoneId, zoneName, zoneRole)) {
    return QueueBoard(
    deviceName: payload?['device_name']?.toString(),
    queuePreview: providerData?['queue_preview'] ?? [],
    notices: providerData?['notices'] ?? [],
    );
    }

    if (_isTickerZone(zoneId, zoneName)) {
    return TickerSlot(
    items: items,
    label: zoneName,
    );
    }

    if (_isLogoZone(zoneId, zoneName, zoneRole) && items.isEmpty) {
    final logoUrl = _getClientLogoUrl();
    if (logoUrl != null) {
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
    return AutoWidgetZone(
    zone: zone,
    queuePreview: providerData?['queue_preview'] ?? [],
    payload: payload,
    providerData: providerData,
    weatherData: liveWeather ?? payload?['weather'] ?? providerData?['weather'],
    canvasWidth: canvasWidth,
    canvasHeight: canvasHeight,
    );
    }

    // Default media slot
    return MediaSlot(
    items: items,
    label: zoneName,
    mediaMode: zoneMediaModes[zoneId] ?? _getDefaultZoneMediaMode(zone),
    );
    }

    bool _isQueueZone(String id, String name, String role) {
    return id.contains('queue') || id.contains('token') ||
    name.contains('queue') || name.contains('token') ||
    role == 'queue';
    }

    bool _isTickerZone(String id, String name) {
    return id.contains('ticker') || name.contains('ticker');
    }

    bool _isLogoZone(String id, String name, String role) {
    return id.contains('logo') || id.contains('brand') ||
    name.contains('logo') || name.contains('brand') ||
    role == 'logo';
    }

    bool _isAutoWidgetZone(String role) {
    return ['header', 'weather', 'bookings'].contains(role.toLowerCase());
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
    return Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.end,
    children: [
    // Menu toggle button
    GestureDetector(
    onTap: _toggleMenu,
    child: Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    decoration: BoxDecoration(
    color: Colors.black87,
    borderRadius: BorderRadius.circular(20),
    border: Border.all(color: Colors.white24),
    boxShadow: [
    BoxShadow(
    color: Colors.black.withOpacity(0.8),
    blurRadius: 40,
    offset: const Offset(0, 14),
    ),
    ],
    ),
    child: Row(
    mainAxisSize: MainAxisSize.min,
    children: [
    Icon(
    menuOpen ? Icons.close : Icons.menu,
    size: 16,
    color: Colors.white,
    ),
    const SizedBox(width: 8),
    const Text(
    'MENU',
    style: TextStyle(
    color: Colors.white,
    fontSize: 12,
    fontWeight: FontWeight.w600,
    letterSpacing: 2,
    ),
    ),
    ],
    ),
    ),
    ),

    // Menu panel
    if (menuOpen)
    Container(
    width: 350,
    margin: const EdgeInsets.only(top: 12),
    constraints: const BoxConstraints(maxHeight: 500),
    decoration: BoxDecoration(
    color: const Color(0xFA0F172A),
    borderRadius: BorderRadius.circular(24),
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
    borderRadius: BorderRadius.circular(24),
    child: SingleChildScrollView(
    child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
    // Header
    Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
    color: const Color(0xFA0F172A),
    border: Border(
    bottom: BorderSide(color: Colors.white.withOpacity(0.1)),
    ),
    ),
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
    'Controls and zones',
    style: TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w600,
    color: Colors.white,
    ),
    ),
    ],
    ),
    ),

    // Controls section
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

    // Buttons grid
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
    onTap: () {
    setState(() {
    showPairing = true;
    menuOpen = false;
    });
    },
    ),
    _buildMenuButtonItem(
    icon: Icons.restore,
    label: 'Restore All Zones',
    onTap: _resetZones,
    ),
    ],
    ),

    const SizedBox(height: 16),

    // Orientation
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

    // Zone settings
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

    // Zone list
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
    ],
    );
    }

    Widget _buildMenuButtonItem({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    }) {
    return GestureDetector(
    onTap: onTap,
    child: Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    decoration: BoxDecoration(
    color: Colors.white.withOpacity(0.05),
    borderRadius: BorderRadius.circular(16),
    border: Border.all(color: Colors.white10),
    ),
    child: Row(
    mainAxisSize: MainAxisSize.min,
    children: [
    Icon(icon, size: 16, color: Colors.white70),
    const SizedBox(width: 8),
    Text(
    label,
    style: const TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w500,
    color: Colors.white,
    ),
    ),
    ],
    ),
    ),
    );
    }
    }

    // Splash Screen
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
    // Animated background orbs
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

    // Content
    Center(
    child: Column(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
    // Animated logo
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

    // Progress bar
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

    // Loading text
    Text(
    'Loading$dots',
    style: TextStyle(
    fontSize: 12,
    color: Colors.white.withOpacity(0.6),
    letterSpacing: 3,
    ),
    ),

    const SizedBox(height: 40),

    // Feature tags
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

    // Pairing Screen
    class PairingScreen extends StatefulWidget {
    final Function(String) onPair;
    final String error;

    const PairingScreen({
    super.key,
    required this.onPair,
    required this.error,
    });

    @override
    State<PairingScreen> createState() => _PairingScreenState();
    }

    class _PairingScreenState extends State<PairingScreen> {
    final TextEditingController _codeController = TextEditingController();
    bool isLoading = false;
    bool isConnecting = false;

    void _handleSubmit() {
    final code = _codeController.text.trim().toUpperCase();
    if (code.isEmpty) {
    return;
    }

    setState(() {
    isLoading = true;
    isConnecting = true;
    });

    Future.delayed(const Duration(seconds: 1), () {
    if (mounted) {
    widget.onPair(code);
    }
    });
    }

    @override
    void dispose() {
    _codeController.dispose();
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
    Color(0xFF1A237E),
    Color(0xFF4A148C),
    Color(0xFF1A237E),
    ],
    ),
    ),
    child: Stack(
    children: [
    // Background pattern
    Positioned.fill(
    child: Opacity(
    opacity: 0.05,
    child: CustomPaint(
    painter: GridPatternPainter(),
    ),
    ),
    ),

    // Floating orbs
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

    // Content
    Center(
    child: SingleChildScrollView(
    padding: const EdgeInsets.all(24),
    child: Column(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
    // Logo
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

    // Card
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
    'Pair Your Device',
    style: TextStyle(
    fontSize: 24,
    fontWeight: FontWeight.bold,
    color: Colors.white,
    ),
    ),
    const SizedBox(height: 8),
    Text(
    'Enter the pairing code from your client\ndashboard to start displaying content',
    textAlign: TextAlign.center,
    style: TextStyle(
    fontSize: 14,
    color: Colors.white.withOpacity(0.6),
    ),
    ),

    const SizedBox(height: 32),

    // Input field
    TextField(
    controller: _codeController,
    textCapitalization: TextCapitalization.characters,
    textAlign: TextAlign.center,
    maxLength: 10,
    style: const TextStyle(
    color: Colors.white,
    fontSize: 28,
    fontFamily: 'monospace',
    letterSpacing: 4,
    ),
    decoration: InputDecoration(
    counterText: '',
    hintText: 'e.g., ABC123',
    hintStyle: TextStyle(
    color: Colors.white.withOpacity(0.3),
    fontSize: 28,
    fontFamily: 'monospace',
    letterSpacing: 4,
    ),
    filled: true,
    fillColor: Colors.white.withOpacity(0.1),
    border: OutlineInputBorder(
    borderRadius: BorderRadius.circular(16),
    borderSide: BorderSide.none,
    ),
    focusedBorder: OutlineInputBorder(
    borderRadius: BorderRadius.circular(16),
    borderSide: BorderSide(
    color: Colors.cyan.withOpacity(0.5),
    width: 2,
    ),
    ),
    ),
    onSubmitted: (_) => _handleSubmit(),
    ),

    const SizedBox(height: 8),
    Text(
    'Find this code in your client portal under "Devices"',
    style: TextStyle(
    fontSize: 12,
    color: Colors.white.withOpacity(0.3),
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

    if (isConnecting) ...[
    const SizedBox(height: 16),
    Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
    color: Colors.cyan.withOpacity(0.2),
    borderRadius: BorderRadius.circular(12),
    border: Border.all(color: Colors.cyan.withOpacity(0.3)),
    ),
    child: const Row(
    children: [
    SizedBox(
    width: 20,
    height: 20,
    child: CircularProgressIndicator(
    strokeWidth: 2,
    color: Colors.cyanAccent,
    ),
    ),
    SizedBox(width: 8),
    Text(
    'Connecting to server...',
    style: TextStyle(
    color: Colors.cyanAccent,
    fontSize: 14,
    ),
    ),
    ],
    ),
    ),
    ],

    const SizedBox(height: 24),

    // Submit button
    SizedBox(
    width: double.infinity,
    child: ElevatedButton(
    onPressed: isLoading ? null : _handleSubmit,
    style: ElevatedButton.styleFrom(
    padding: const EdgeInsets.symmetric(vertical: 16),
    backgroundColor: const Color(0xFF7C3AED),
    foregroundColor: Colors.white,
    shape: RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(16),
    ),
    ),
    child: isLoading
    ? const SizedBox(
    width: 20,
    height: 20,
    child: CircularProgressIndicator(
    strokeWidth: 2,
    color: Colors.white,
    ),
    )
    : const Row(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
    Text(
    'CONNECT NOW',
    style: TextStyle(
    fontWeight: FontWeight.w600,
    letterSpacing: 2,
    ),
    ),
    SizedBox(width: 8),
    Icon(Icons.arrow_forward, size: 18),
    ],
    ),
    ),
    ),
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

    // Media Slot Widget
    class MediaSlot extends StatefulWidget {
    final List<Map<String, dynamic>> items;
    final String label;
    final String mediaMode;

    const MediaSlot({
    super.key,
    required this.items,
    required this.label,
    this.mediaMode = 'fill',
    });

    @override
    State<MediaSlot> createState() => _MediaSlotState();
    }

    class _MediaSlotState extends State<MediaSlot> {
    int currentIndex = 0;
    Timer? timer;
    bool showFrame = true;
    YoutubePlayerController? youtubeController;
    VideoPlayerController? videoController;

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
    if (oldWidget.items.length != widget.items.length) {
    setState(() => currentIndex = 0);
    _setupTimer();
    }
    }

    void _setupTimer() {
    timer?.cancel();
    if (widget.items.isEmpty || currentIndex >= widget.items.length) return;

    final item = widget.items[currentIndex];
    final duration = (item['duration'] ?? 10).toInt();

    if (item['type'] != 'video' && item['type'] != 'youtube') {
    timer = Timer(Duration(seconds: duration), _nextItem);
    }
    }

    void _nextItem() {
    if (!mounted) return;
    setState(() {
    currentIndex = (currentIndex + 1) % widget.items.length;
    showFrame = false;
    });
    Future.delayed(const Duration(milliseconds: 30), () {
    if (mounted) {
    setState(() => showFrame = true);
    _setupTimer();
    }
    });
    }

    @override
    void dispose() {
    timer?.cancel();
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
    final rawType = (item['type'] ?? item['kind'] ?? 'media').toString().toLowerCase();
    final itemUrl = _resolveUrl(item);
    final itemType = rawType == 'media'
    ? (_getYoutubeId(item['url']?.toString() ?? '') != null
    ? 'youtube'
    : _isVideoUrl(itemUrl)
    ? 'video'
    : rawType)
    : rawType;

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
    content = _buildYoutube(item);
    break;
    case 'video':
    content = _buildVideo(item);
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
    child: content,
    ),
    );
    }

    Widget _buildClock(Map<String, dynamic> item) {
    return StreamBuilder(
    stream: Stream.periodic(const Duration(seconds: 1)),
    builder: (context, snapshot) {
    final now = DateTime.now();
    final time = '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
    final date = '${_getWeekday(now.weekday)}, ${_getMonth(now.month)} ${now.day}';

    return Container(
    decoration: const BoxDecoration(
    gradient: RadialGradient(
    center: Alignment.topCenter,
    colors: [Color(0x24FFFFFF), Colors.transparent],
    ),
    ),
    child: Container(
    decoration: const BoxDecoration(
    gradient: LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [Color(0xFF1F2937), Color(0xFF0B1120)],
    ),
    ),
    padding: const EdgeInsets.all(20),
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
    fontSize: 10,
    letterSpacing: 4.5,
    color: Colors.white.withOpacity(0.45),
    ),
    ),
    const SizedBox(height: 8),
    Text(
    item['location']?.toString() ?? 'Local time',
    style: TextStyle(
    fontSize: 14,
    color: Colors.white.withOpacity(0.7),
    ),
    ),
    ],
    ),
    Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
    Text(
    time,
    style: const TextStyle(
    fontSize: 72,
    fontWeight: FontWeight.w900,
    color: Colors.white,
    letterSpacing: -2,
    ),
    ),
    const SizedBox(height: 8),
    Text(
    date,
    style: TextStyle(
    fontSize: 18,
    color: Colors.white.withOpacity(0.8),
    ),
    ),
    const SizedBox(height: 16),
    Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
    decoration: BoxDecoration(
    color: Colors.white.withOpacity(0.05),
    borderRadius: BorderRadius.circular(20),
    border: Border.all(color: Colors.white10),
    ),
    child: Row(
    mainAxisSize: MainAxisSize.min,
    children: [
    Container(
    width: 8,
    height: 8,
    decoration: const BoxDecoration(
    color: Colors.greenAccent,
    shape: BoxShape.circle,
    ),
    ),
    const SizedBox(width: 8),
    const Text(
    'LIVE',
    style: TextStyle(
    fontSize: 12,
    color: Colors.white60,
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
    );
    }

    Widget _buildWeather(Map<String, dynamic> item) {
    final temp = item['temperature']?.toString() ?? '--';
    final condition = item['condition']?.toString() ?? 'Clear';
    final location = item['location']?.toString() ?? 'Current conditions';

    return Container(
    decoration: BoxDecoration(
    gradient: RadialGradient(
    center: Alignment.topCenter,
    colors: [Color(0x2238BDF8), Colors.transparent],
    radius: 0.4,
    ),
    ),
    child: Container(
    decoration: const BoxDecoration(
    gradient: LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [Color(0xFF0F172A), Color(0xFF111827)],
    ),
    ),
    padding: const EdgeInsets.all(20),
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
    fontSize: 10,
    letterSpacing: 4.5,
    color: Colors.cyan.withOpacity(0.7),
    ),
    ),
    const SizedBox(height: 8),
    Text(
    location,
    style: TextStyle(
    fontSize: 14,
    color: Colors.white.withOpacity(0.7),
    ),
    ),
    ],
    ),
    Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
    Text(
    '$temp°',
    style: const TextStyle(
    fontSize: 80,
    fontWeight: FontWeight.w900,
    color: Colors.white,
    letterSpacing: -2,
    ),
    ),
    const SizedBox(height: 12),
    Text(
    '☀️ $condition',
    style: TextStyle(
    fontSize: 18,
    fontWeight: FontWeight.w600,
    color: Colors.white.withOpacity(0.9),
    ),
    ),
    const SizedBox(height: 12),
    Wrap(
    spacing: 8,
    runSpacing: 8,
    children: [
    _buildWeatherChip('H ${item['high'] ?? '--'}°'),
    _buildWeatherChip('L ${item['low'] ?? '--'}°'),
    if (item['humidity'] != null)
    _buildWeatherChip('Humidity ${item['humidity']}%'),
    ],
    ),
    ],
    ),
    ],
    ),
    ),
    );
    }

    Widget _buildWeatherChip(String text) {
    return Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
    decoration: BoxDecoration(
    color: Colors.white.withOpacity(0.05),
    borderRadius: BorderRadius.circular(20),
    border: Border.all(color: Colors.white10),
    ),
    child: Text(
    text,
    style: const TextStyle(
    fontSize: 12,
    color: Colors.white60,
    letterSpacing: 2,
    ),
    ),
    );
    }

    Widget _buildText(Map<String, dynamic> item) {
    return Container(
    color: Colors.black,
    child: Center(
    child: Padding(
    padding: const EdgeInsets.all(24),
    child: Text(
    item['content']?.toString() ?? item['text']?.toString() ?? '',
    textAlign: TextAlign.center,
    style: const TextStyle(
    fontSize: 24,
    fontWeight: FontWeight.bold,
    color: Colors.white,
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
    youtubeController = YoutubePlayerController(
    initialVideoId: videoId,
    flags: const YoutubePlayerFlags(
    autoPlay: true,
    mute: true,
    hideControls: false,
    disableDragSeek: false,
    ),
    );
    youtubeController!.addListener(() {
    if (youtubeController!.value.playerState == PlayerState.ended) {
    _nextItem();
    }
    });
    }

    return YoutubePlayer(
    controller: youtubeController!,
    showVideoProgressIndicator: true,
    progressIndicatorColor: Colors.redAccent,
    onReady: () {
    youtubeController?.play();
    },
    );
    }

    Widget _buildVideo(Map<String, dynamic> item) {
    final url = _resolveUrl(item);
    if (url.isEmpty) return const SizedBox();

    if (videoController == null || videoController!.dataSource != url) {
    videoController?.dispose();
    videoController = VideoPlayerController.networkUrl(Uri.parse(url))
    ..initialize().then((_) {
    if (mounted) setState(() {});
    videoController!.setLooping(false);
    videoController!.play();
    videoController!.addListener(() {
    if (videoController!.value.position >= videoController!.value.duration) {
    _nextItem();
    }
    });
    });
    }

    if (videoController == null || !videoController!.value.isInitialized) {
    return const Center(child: CircularProgressIndicator());
    }

    return VideoPlayer(videoController!);
    }

    Widget _buildBookings(Map<String, dynamic> item) {
    final entries = item['entries'] as List<dynamic>? ?? [];

    return Container(
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
    (item['notices'] as List<dynamic>?) ?? [];

    return Container(
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
    (item['media_id'] != null ? '/api/media/${item['media_id']}' : '') ??
    '';

    if (candidate.isEmpty) return '';
    if (candidate.startsWith('http://') || candidate.startsWith('https://') ||
    candidate.startsWith('data:')) {
    return candidate;
    }

    final base = 'http://10.18.51.60:8000';
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

    // Ticker Slot Widget
    class TickerSlot extends StatelessWidget {
    final List<Map<String, dynamic>> items;
    final String label;

    const TickerSlot({
    super.key,
    required this.items,
    required this.label,
    });

    @override
    Widget build(BuildContext context) {
    if (items.isEmpty) {
    return Container(
    color: Colors.black,
    child: Center(
    child: Text(
    label.toUpperCase(),
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

    final tickerTexts = items.map((item) {
    return item['text']?.toString() ??
    item['title']?.toString() ??
    item['message']?.toString() ?? '';
    }).where((text) => text.isNotEmpty).toList();

    if (tickerTexts.isEmpty) {
    return Container(color: Colors.black);
    }

    final tickerText = tickerTexts.join('  •  ');

    return Container(
    color: Colors.black,
    child: Center(
    child: Marquee(
    text: tickerText,
    style: const TextStyle(
    color: Colors.white,
    fontWeight: FontWeight.w600,
    fontSize: 14,
    ),
    scrollAxis: Axis.horizontal,
    crossAxisAlignment: CrossAxisAlignment.center,
    blankSpace: 100,
    velocity: 50,
    pauseAfterRound: const Duration(seconds: 0),
    startPadding: 10,
    accelerationDuration: const Duration(seconds: 1),
    accelerationCurve: Curves.linear,
    decelerationDuration: const Duration(milliseconds: 500),
    decelerationCurve: Curves.easeOut,
    ),
    ),
    );
    }
    }

    // Queue Board Widget
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
    if (queuePreview.isEmpty) {
    return Container(
    decoration: const BoxDecoration(
    gradient: LinearGradient(
    colors: [Colors.pink, Colors.deepOrange],
    ),
    ),
    child: const Center(
    child: Text(
    'NO QUEUE',
    style: TextStyle(
    color: Colors.white,
    fontSize: 24,
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

    return Container(
    decoration: const BoxDecoration(
    gradient: LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [
    Color(0xFFEC4899),
    Color(0xFFFB7185),
    Color(0xFFF97316),
    ],
    ),
    ),
    child: Column(
    children: [
    // Status bar
    Container(
    padding: const EdgeInsets.symmetric(vertical: 16),
    decoration: BoxDecoration(
    color: Colors.white.withOpacity(0.15),
    border: Border(
    bottom: BorderSide(
    color: Colors.white.withOpacity(0.3),
    width: 2,
    ),
    ),
    ),
    child: const Center(
    child: Text(
    '🔴 LIVE QUEUE STATUS',
    style: TextStyle(
    color: Colors.white,
    fontWeight: FontWeight.w900,
    fontSize: 16,
    letterSpacing: 4,
    ),
    ),
    ),
    ),

    // Current token
    Expanded(
    child: Center(
    child: Column(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
    const Text(
    '⚡ CURRENTLY SERVING',
    style: TextStyle(
    color: Colors.white,
    fontWeight: FontWeight.bold,
    fontSize: 14,
    letterSpacing: 3,
    ),
    ),
    const SizedBox(height: 16),
    Text(
    currentToken['token']?.toString() ?? '—',
    style: const TextStyle(
    fontSize: 120,
    fontWeight: FontWeight.w900,
    color: Colors.white,
    shadows: [
    Shadow(
    color: Colors.black26,
    offset: Offset(4, 4),
    blurRadius: 0,
    ),
    ],
    ),
    ),
    const SizedBox(height: 16),
    Text(
    currentToken['patient_name']?.toString() ??
    currentToken['service_name']?.toString() ??
    'GUEST',
    style: const TextStyle(
    fontSize: 28,
    fontWeight: FontWeight.w800,
    color: Colors.white,
    ),
    ),
    const SizedBox(height: 8),
    Text(
    currentToken['service_type']?.toString() ??
    currentToken['service_name']?.toString() ??
    '→ PLEASE PROCEED TO COUNTER ←',
    style: TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w600,
    color: Colors.white.withOpacity(0.8),
    ),
    ),
    ],
    ),
    ),
    ),

    // Next tokens
    if (nextTokens.isNotEmpty)
    Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
    color: Colors.black.withOpacity(0.3),
    border: Border(
    top: BorderSide(
    color: Colors.white.withOpacity(0.3),
    width: 2,
    ),
    ),
    ),
    child: Column(
    children: [
    const Text(
    '⏩ NEXT IN QUEUE',
    style: TextStyle(
    color: Colors.white70,
    fontWeight: FontWeight.bold,
    fontSize: 12,
    letterSpacing: 3,
    ),
    ),
    const SizedBox(height: 12),
    Row(
    children: nextTokens.map((token) {
    final t = token as Map<String, dynamic>;
    return Expanded(
    child: Container(
    margin: const EdgeInsets.symmetric(horizontal: 8),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
    color: Colors.white.withOpacity(0.15),
    border: Border.all(
    color: Colors.white.withOpacity(0.3),
    width: 2,
    ),
    ),
    child: Column(
    children: [
    Text(
    t['token']?.toString() ?? '—',
    style: const TextStyle(
    fontSize: 32,
    fontWeight: FontWeight.w900,
    color: Colors.white,
    ),
    ),
    const SizedBox(height: 8),
    Text(
    t['patient_name']?.toString() ??
    t['service_name']?.toString() ??
    'GUEST',
    style: const TextStyle(
    fontWeight: FontWeight.bold,
    color: Colors.white,
    ),
    textAlign: TextAlign.center,
    overflow: TextOverflow.ellipsis,
    ),
    const SizedBox(height: 4),
    Text(
    t['service_type']?.toString() ??
    t['service_name']?.toString() ??
    'QUEUE',
    style: TextStyle(
    fontSize: 12,
    color: Colors.white.withOpacity(0.6),
    ),
    textAlign: TextAlign.center,
    ),
    if (t['wait_after_mins'] != null) ...[
    const SizedBox(height: 4),
    Text(
    '${t['wait_after_mins']}m wait',
    style: const TextStyle(
    fontSize: 10,
    fontWeight: FontWeight.w900,
    color: Colors.white,
    ),
    ),
    ],
    ],
    ),
    ),
    );
    }).toList(),
    ),
    ],
    ),
    ),

    // Notice banner
    if (notices.isNotEmpty && notices.first != null)
    Container(
    padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 16),
    decoration: BoxDecoration(
    color: Colors.black.withOpacity(0.4),
    border: Border(
    top: BorderSide(
    color: Colors.white.withOpacity(0.3),
    width: 2,
    ),
    ),
    ),
    child: Center(
    child: Text(
    '📢 ${notices.first['title'] ?? notices.first['body'] ?? 'QUEUE UPDATES AVAILABLE'}',
    style: const TextStyle(
    fontWeight: FontWeight.bold,
    color: Colors.white,
    ),
    textAlign: TextAlign.center,
    ),
    ),
    ),
    ],
    ),
    );
    }
    }

    // Auto Widget Zone
    class AutoWidgetZone extends StatelessWidget {
    final Map<String, dynamic> zone;
    final List<dynamic> queuePreview;
    final Map<String, dynamic>? payload;
    final Map<String, dynamic>? providerData;
    final dynamic weatherData;
    final double canvasWidth;
    final double canvasHeight;

    const AutoWidgetZone({
    super.key,
    required this.zone,
    required this.queuePreview,
    this.payload,
    this.providerData,
    this.weatherData,
    required this.canvasWidth,
    required this.canvasHeight,
    });

    @override
    Widget build(BuildContext context) {
    final role = (zone['role'] ?? '').toString().toLowerCase();

    switch (role) {
    case 'header':
    return _buildHeader();
    case 'weather':
    return _buildWeather();
    case 'bookings':
    return _buildBookings();
    default:
    return const SizedBox();
    }
    }

    Widget _buildHeader() {
    final now = DateTime.now();
    final date = '${_getWeekday(now.weekday)}, ${_getMonth(now.month)} ${now.day}';
    final time = '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';

    return Container(
    decoration: const BoxDecoration(
    gradient: LinearGradient(
    colors: [Color(0xFF111827), Color(0xFF0F172A)],
    ),
    ),
    padding: const EdgeInsets.all(16),
    child: Row(
    mainAxisAlignment: MainAxisAlignment.spaceBetween,
    children: [
    Column(
    mainAxisAlignment: MainAxisAlignment.center,
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
    Text(
    'TODAY',
    style: TextStyle(
    fontSize: 10,
    letterSpacing: 4.5,
    color: Colors.white.withOpacity(0.45),
    ),
    ),
    const SizedBox(height: 4),
    Text(
    date,
    style: const TextStyle(
    fontSize: 28,
    fontWeight: FontWeight.w900,
    color: Colors.white,
    ),
    ),
    ],
    ),
    Column(
    mainAxisAlignment: MainAxisAlignment.center,
    crossAxisAlignment: CrossAxisAlignment.end,
    children: [
    Text(
    'LOCAL TIME',
    style: TextStyle(
    fontSize: 10,
    letterSpacing: 4.5,
    color: Colors.white.withOpacity(0.45),
    ),
    ),
    const SizedBox(height: 4),
    Text(
    time,
    style: const TextStyle(
    fontSize: 36,
    fontWeight: FontWeight.w900,
    color: Colors.white,
    ),
    ),
    ],
    ),
    ],
    ),
    );
    }

    Widget _buildWeather() {
    final weather = (weatherData as Map<String, dynamic>?) ?? {};
    final temp = weather['temperature']?.toString() ?? '--';
    final condition = weather['condition']?.toString() ?? 'Weather sync pending';
    final high = weather['high']?.toString() ?? '--';
    final low = weather['low']?.toString() ?? '--';

    return Container(
    decoration: BoxDecoration(
    gradient: RadialGradient(
    center: Alignment.topCenter,
    colors: [Color(0x2238BDF8), Colors.transparent],
    radius: 0.4,
    ),
    ),
    child: Container(
    decoration: const BoxDecoration(
    gradient: LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [Color(0xFF0F172A), Color(0xFF111827)],
    ),
    ),
    padding: const EdgeInsets.all(20),
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
    fontSize: 10,
    letterSpacing: 4.5,
    color: Colors.cyan.withOpacity(0.7),
    ),
    ),
    const SizedBox(height: 8),
    Text(
    weather['location']?.toString() ?? 'Current conditions',
    style: TextStyle(
    fontSize: 14,
    color: Colors.white.withOpacity(0.7),
    ),
    ),
    ],
    ),
    Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
    Text(
    '$temp°',
    style: const TextStyle(
    fontSize: 80,
    fontWeight: FontWeight.w900,
    color: Colors.white,
    letterSpacing: -2,
    ),
    ),
    const SizedBox(height: 12),
    Text(
    '☀️ $condition',
    style: TextStyle(
    fontSize: 18,
    fontWeight: FontWeight.w600,
    color: Colors.white.withOpacity(0.9),
    ),
    ),
    const SizedBox(height: 12),
    Wrap(
    spacing: 8,
    runSpacing: 8,
    children: [
    _buildChip('H $high°'),
    _buildChip('L $low°'),
    ],
    ),
    ],
    ),
    ],
    ),
    ),
    );
    }

    Widget _buildBookings() {
    final entries = queuePreview.map((item) {
    final i = item as Map<String, dynamic>;
    return {
    'token': i['token'],
    'name': i['patient_name'] ?? i['service_name'] ?? 'Booking',
    'time': i['assigned_time'] ?? i['preferred_time'] ?? '${i['wait_after_mins'] ?? 0} min',
    'service': i['service_type'] ?? i['service_name'] ?? 'Appointment',
    };
    }).toList();

    return Container(
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
    letterSpacing: 4,
    color: Color(0xFF94A3B8),
    ),
    ),
    const SizedBox(height: 4),
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
    padding: const EdgeInsets.all(16),
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
    margin: const EdgeInsets.only(bottom: 12),
    padding: const EdgeInsets.all(16),
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
    width: 56,
    height: 56,
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
    const SizedBox(width: 16),
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
    style: const TextStyle(
    fontSize: 18,
    fontWeight: FontWeight.w600,
    color: Color(0xFF0F172A),
    ),
    ),
    Text(
    entry['service'].toString(),
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
    const SizedBox(height: 8),
    Text(
    entry['time'].toString(),
    style: const TextStyle(
    fontSize: 24,
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

    Widget _buildChip(String text) {
    return Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
    decoration: BoxDecoration(
    color: Colors.white.withOpacity(0.05),
    borderRadius: BorderRadius.circular(20),
    border: Border.all(color: Colors.white10),
    ),
    child: Text(
    text,
    style: const TextStyle(
    fontSize: 12,
    color: Colors.white60,
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
    }*/