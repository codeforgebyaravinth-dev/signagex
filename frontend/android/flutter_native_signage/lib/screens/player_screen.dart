// lib/screens/player_screen.dart
import 'dart:async';
import 'dart:io';
/**
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:video_player/video_player.dart';
import 'package:cached_network_image/cached_network_image.dart';

import '../models/player_payload.dart';
import '../models/player_settings.dart';
import '../services/player_api.dart';

class PlayerScreen extends StatefulWidget {
  final PlayerSettings settings;
  final Future<void> Function(PlayerSettings next) onSettingsChanged;
  final Future<void> Function() onClearPairing;

  const PlayerScreen({
    super.key,
    required this.settings,
    required this.onSettingsChanged,
    required this.onClearPairing,
  });

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen> {
  PlayerPayload? _payload;
  String? _error;
  bool _loading = true;
  late String _orientationMode;
  late String _mediaMode;
  Timer? _pollTimer;
  Timer? _clockTimer;
  DateTime _now = DateTime.now();

  PlayerApi get _api => PlayerApi(baseUrl: widget.settings.backendUrl);

  @override
  void initState() {
    super.initState();
    _orientationMode = widget.settings.orientationMode;
    _mediaMode = widget.settings.mediaMode;
    _applySystemMode();
    _loadPayload();
    _pollTimer = Timer.periodic(const Duration(seconds: 20), (_) => _loadPayload(silent: true));
    _clockTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) {
        setState(() => _now = DateTime.now());
      }
    });
  }

  @override
  void didUpdateWidget(covariant PlayerScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.settings.orientationMode != widget.settings.orientationMode) {
      _orientationMode = widget.settings.orientationMode;
      _applySystemMode();
    }
    if (oldWidget.settings.mediaMode != widget.settings.mediaMode) {
      _mediaMode = widget.settings.mediaMode;
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _clockTimer?.cancel();
    super.dispose();
  }

  Future<void> _applySystemMode() async {
    final orientations = switch (_orientationMode) {
      'portrait' => [DeviceOrientation.portraitUp, DeviceOrientation.portraitDown],
      'landscape' => [DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight],
      _ => [
        DeviceOrientation.portraitUp,
        DeviceOrientation.portraitDown,
        DeviceOrientation.landscapeLeft,
        DeviceOrientation.landscapeRight,
      ],
    };
    await SystemChrome.setPreferredOrientations(orientations);
    await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  }

  Future<void> _loadPayload({bool silent = false}) async {
    final pairCode = widget.settings.pairCode?.trim();
    if (pairCode == null || pairCode.isEmpty) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'No pairing code found';
      });
      return;
    }

    if (!silent && mounted) {
      setState(() => _loading = true);
    }

    try {
      final payload = await _api.fetchPlayerPayload(pairCode);
      if (!mounted) return;
      setState(() {
        _payload = payload;
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _setOrientation(String mode) async {
    final next = widget.settings.copyWith(orientationMode: mode);
    await widget.onSettingsChanged(next);
    if (!mounted) return;
    setState(() => _orientationMode = mode);
    await _applySystemMode();
  }

  Future<void> _setMediaMode(String mode) async {
    final next = widget.settings.copyWith(mediaMode: mode);
    await widget.onSettingsChanged(next);
    if (!mounted) return;
    setState(() => _mediaMode = mode);
  }

  Future<void> _showSettingsSheet() async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF111111),
      showDragHandle: true,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
              child: ListView(
                shrinkWrap: true,
                children: [
                  const Text('Player Settings', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 16),
                  _sectionTitle('Orientation'),
                  ...['auto', 'landscape', 'portrait'].map((mode) {
                    return RadioListTile<String>(
                      value: mode,
                      groupValue: _orientationMode,
                      activeColor: Colors.white,
                      title: Text(mode.toUpperCase(), style: const TextStyle(color: Colors.white)),
                      onChanged: (value) async {
                        if (value == null) return;
                        setSheetState(() => _orientationMode = value);
                        await _setOrientation(value);
                      },
                    );
                  }),
                  const SizedBox(height: 8),
                  _sectionTitle('Media Fit'),
                  ...['fit', 'fill', 'stretch'].map((mode) {
                    return RadioListTile<String>(
                      value: mode,
                      groupValue: _mediaMode,
                      activeColor: Colors.white,
                      title: Text(mode.toUpperCase(), style: const TextStyle(color: Colors.white)),
                      onChanged: (value) async {
                        if (value == null) return;
                        setSheetState(() => _mediaMode = value);
                        await _setMediaMode(value);
                      },
                    );
                  }),
                  const SizedBox(height: 12),
                  ElevatedButton.icon(
                    onPressed: () async {
                      Navigator.of(context).pop();
                      await widget.onClearPairing();
                    },
                    icon: const Icon(Icons.link_off),
                    label: const Text('Clear Pairing'),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final pairCode = widget.settings.pairCode ?? '';

    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        top: false,
        bottom: false,
        child: Stack(
          children: [
            Positioned.fill(child: _buildBody(context)),
            Positioned(
              top: 20,
              right: 20,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _pillLabel('PAIR $pairCode'),
                  const SizedBox(width: 8),
                  IconButton.filledTonal(
                    onPressed: _loadPayload,
                    icon: const Icon(Icons.refresh),
                    tooltip: 'Refresh',
                  ),
                  const SizedBox(width: 8),
                  IconButton.filledTonal(
                    onPressed: _showSettingsSheet,
                    icon: const Icon(Icons.menu),
                    tooltip: 'Settings',
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_loading && _payload == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _payload == null) {
      return _emptyState(
        title: 'Player unavailable',
        message: _error!,
        actionLabel: 'Retry',
        onAction: _loadPayload,
      );
    }
    final payload = _payload;
    if (payload == null) {
      return _emptyState(
        title: 'Waiting for content',
        message: 'No player payload has been loaded yet.',
        actionLabel: 'Refresh',
        onAction: _loadPayload,
      );
    }

    final zones = payload.visibleZones;
    final hasAbsoluteLayout = payload.layoutZones.any((zone) => zone.x != null || zone.y != null || zone.widthPx != null || zone.heightPx != null);

    if (zones.isEmpty) {
      return _emptyState(
        title: payload.deviceName ?? 'RpSignage',
        message: 'The device is paired, but no zones are scheduled yet.',
        actionLabel: 'Refresh',
        onAction: _loadPayload,
      );
    }

    if (hasAbsoluteLayout) {
      return LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          final height = constraints.maxHeight;
          final template = payload.raw['template'];
          final layout = template is Map ? template['layout'] : null;
          final canvasWidth = _asDouble(layout is Map ? layout['canvas_width'] : null) ?? 1920;
          final canvasHeight = _asDouble(layout is Map ? layout['canvas_height'] : null) ?? 1080;

          return Stack(
            fit: StackFit.expand,
            children: [
              for (final zone in zones)
                Positioned(
                  left: ((zone.x ?? 0) / canvasWidth) * width,
                  top: ((zone.y ?? 0) / canvasHeight) * height,
                  width: ((zone.widthPx ?? canvasWidth) / canvasWidth) * width,
                  height: ((zone.heightPx ?? canvasHeight) / canvasHeight) * height,
                  child: _ZoneCard(
                    zone: zone,
                    items: payload.zones[zone.id] ?? const [],
                    now: _now,
                    mediaMode: _mediaMode,
                    baseUrl: widget.settings.backendUrl,
                  ),
                ),
            ],
          );
        },
      );
    }

    final crossAxisCount = zones.length <= 2 ? zones.length : zones.length <= 4 ? 2 : 3;
    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(16, 72, 16, 16),
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: crossAxisCount,
        crossAxisSpacing: 16,
        mainAxisSpacing: 16,
        childAspectRatio: 16 / 9,
      ),
      itemCount: zones.length,
      itemBuilder: (context, index) {
        final zone = zones[index];
        return _ZoneCard(
          zone: zone,
          items: payload.zones[zone.id] ?? const [],
          now: _now,
          mediaMode: _mediaMode,
          baseUrl: widget.settings.backendUrl,
        );
      },
    );
  }

  Widget _emptyState({
    required String title,
    required String message,
    required String actionLabel,
    required Future<void> Function() onAction,
  }) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.tv, color: Colors.white54, size: 72),
              const SizedBox(height: 20),
              Text(title, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w700)),
              const SizedBox(height: 10),
              Text(message, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70)),
              const SizedBox(height: 22),
              ElevatedButton(onPressed: onAction, child: Text(actionLabel)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _pillLabel(String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.55),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: Colors.white.withOpacity(0.12)),
      ),
      child: Text(
        text,
        style: const TextStyle(color: Colors.white70, fontSize: 12, letterSpacing: 1.4, fontWeight: FontWeight.w600),
      ),
    );
  }

  Widget _sectionTitle(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(text, style: const TextStyle(color: Colors.white70, fontSize: 12, letterSpacing: 1.1, fontWeight: FontWeight.w700)),
    );
  }
}

class _ZoneCard extends StatelessWidget {
  final PlayerZoneDefinition zone;
  final List<PlayerMediaItem> items;
  final DateTime now;
  final String mediaMode;
  final String baseUrl;

  const _ZoneCard({
    required this.zone,
    required this.items,
    required this.now,
    required this.mediaMode,
    required this.baseUrl,
  });

  bool get _isClockZone => _contains('clock');
  bool get _isWeatherZone => _contains('weather');
  bool get _isNoticeZone => _contains('notice');

  bool _contains(String needle) {
    final combined = '${zone.id} ${zone.name ?? ''} ${zone.role ?? ''}'.toLowerCase();
    return combined.contains(needle);
  }

  String? _resolveUrl(String? url) {
    if (url == null || url.isEmpty) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    final cleanBase = baseUrl.replaceAll(RegExp(r'/$'), '');
    if (url.startsWith('/')) {
      return '$cleanBase$url';
    }
    return '$cleanBase/$url';
  }

  @override
  Widget build(BuildContext context) {
    final title = zone.name ?? zone.role ?? zone.id;
    final content = _zoneContent(context);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.05),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: Stack(
        children: [
          Positioned.fill(child: content),
          Positioned(
            left: 14,
            top: 12,
            child: Text(
              title,
              style: const TextStyle(color: Colors.white70, fontSize: 11, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }

  Widget _zoneContent(BuildContext context) {
    if (_isClockZone) {
      return _ClockWidget(now: now);
    }
    if (_isWeatherZone) {
      return _WeatherWidget(raw: items.isNotEmpty ? items.first.raw : const {});
    }
    if (_isNoticeZone) {
      return _NoticeWidget(items: items);
    }
    if (items.isEmpty) {
      return _placeholder('No media scheduled');
    }
    return _MediaRenderer(
      item: items.first,
      mediaMode: mediaMode,
      baseUrl: baseUrl,
      resolveUrl: _resolveUrl,
    );
  }

  Widget _placeholder(String text) {
    return Center(
      child: Text(
        text,
        style: const TextStyle(color: Colors.white54, fontSize: 14),
        textAlign: TextAlign.center,
      ),
    );
  }
}

class _MediaRenderer extends StatefulWidget {
  final PlayerMediaItem item;
  final String mediaMode;
  final String baseUrl;
  final String? Function(String? url) resolveUrl;

  const _MediaRenderer({
    required this.item,
    required this.mediaMode,
    required this.baseUrl,
    required this.resolveUrl,
  });

  @override
  State<_MediaRenderer> createState() => _MediaRendererState();
}

class _MediaRendererState extends State<_MediaRenderer> {
  VideoPlayerController? _controller;
  Future<void>? _initFuture;
  bool _hasError = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void didUpdateWidget(covariant _MediaRenderer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.item.url != widget.item.url || oldWidget.item.id != widget.item.id) {
      _disposeController();
      _bootstrap();
    }
  }

  void _bootstrap() {
    _hasError = false;
    _errorMessage = null;

    final resolvedUrl = widget.resolveUrl(widget.item.url);
    if (resolvedUrl == null) {
      _hasError = true;
      _errorMessage = 'No media URL provided';
      return;
    }

    debugPrint('Loading media from: $resolvedUrl');
    debugPrint('Media type - isImage: ${widget.item.isImage}, isVideo: ${widget.item.isVideo}');
    debugPrint('Content type: ${widget.item.contentType}');
    debugPrint('Kind: ${widget.item.kind}');

    if (widget.item.isVideo) {
      try {
        _controller = VideoPlayerController.networkUrl(Uri.parse(resolvedUrl));
        _initFuture = _controller!.initialize().then((_) {
          if (mounted) {
            _controller!
              ..setLooping(true)
              ..setVolume(0.0)
              ..play();
            setState(() {});
          }
        }).catchError((error) {
          debugPrint('Video initialization error: $error');
          if (mounted) {
            setState(() {
              _hasError = true;
              _errorMessage = 'Video error: ${error.toString()}';
            });
          }
        });
      } catch (e) {
        debugPrint('Video controller error: $e');
        _hasError = true;
        _errorMessage = 'Failed to initialize video';
      }
      return;
    }

    _controller = null;
    _initFuture = null;
  }

  void _disposeController() {
    _controller?.pause();
    _controller?.dispose();
    _controller = null;
    _initFuture = null;
  }

  @override
  void dispose() {
    _disposeController();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final fit = switch (widget.mediaMode) {
      'fill' => BoxFit.cover,
      'stretch' => BoxFit.fill,
      _ => BoxFit.contain,
    };

    if (_hasError) {
      return _errorWidget(_errorMessage ?? 'Media unavailable');
    }

    final resolvedUrl = widget.resolveUrl(widget.item.url);
    if (resolvedUrl == null) {
      return _errorWidget('No media URL');
    }

    if (widget.item.isVideo && _controller != null) {
      return FutureBuilder<void>(
        future: _initFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return _errorWidget('Video error: ${snapshot.error}');
          }
          if (!_controller!.value.isInitialized) {
            return const Center(child: CircularProgressIndicator());
          }
          return Container(
            color: Colors.black,
            child: FittedBox(
              fit: fit,
              child: SizedBox(
                width: _controller!.value.size.width,
                height: _controller!.value.size.height,
                child: VideoPlayer(_controller!),
              ),
            ),
          );
        },
      );
    }

    if (widget.item.isImage) {
      return Container(
        color: Colors.black,
        child: CachedNetworkImage(
          imageUrl: resolvedUrl,
          fit: fit,
          width: double.infinity,
          height: double.infinity,
          placeholder: (context, url) => const Center(child: CircularProgressIndicator()),
          errorWidget: (context, url, error) {
            debugPrint('Image load error: $error');
            debugPrint('Failed URL: $url');
            return _errorWidget('Image unavailable');
          },
        ),
      );
    }

    if (widget.item.kind == 'text' || widget.item.contentType?.contains('text') == true) {
      return Container(
        color: Colors.black,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              widget.item.description ?? widget.item.name ?? 'Content',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white, fontSize: 18),
            ),
          ),
        ),
      );
    }

    return _debugWidget(widget.item);
  }

  Widget _errorWidget(String message) {
    return Container(
      color: Colors.red.shade900.withOpacity(0.3),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: Colors.redAccent, size: 48),
              const SizedBox(height: 12),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white70, fontSize: 14),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _debugWidget(PlayerMediaItem item) {
    return Container(
      color: Colors.blue.shade900.withOpacity(0.3),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.info_outline, color: Colors.blueAccent, size: 32),
              const SizedBox(height: 8),
              Text(
                item.name ?? 'Media Item',
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 4),
              Text(
                'Type: ${item.kind ?? item.contentType ?? "unknown"}',
                style: const TextStyle(color: Colors.white70, fontSize: 12),
              ),
              if (item.url != null)
                Text(
                  'URL: ${item.url!.length > 50 ? '${item.url!.substring(0, 50)}...' : item.url!}',
                  style: const TextStyle(color: Colors.white54, fontSize: 10),
                  textAlign: TextAlign.center,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ClockWidget extends StatelessWidget {
  final DateTime now;

  const _ClockWidget({required this.now});

  @override
  Widget build(BuildContext context) {
    final time = DateFormat('HH:mm').format(now);
    final date = DateFormat('EEE, d MMM').format(now);
    return Container(
      decoration: BoxDecoration(gradient: LinearGradient(colors: [Colors.blue.shade900, Colors.black])),
      child: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(time, style: const TextStyle(color: Colors.white, fontSize: 56, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Text(date, style: const TextStyle(color: Colors.white70, fontSize: 18)),
          ],
        ),
      ),
    );
  }
}

class _WeatherWidget extends StatelessWidget {
  final Map<String, dynamic> raw;

  const _WeatherWidget({required this.raw});

  @override
  Widget build(BuildContext context) {
    final condition = _firstText(raw, ['condition', 'summary', 'description']) ?? 'Weather';
    final temperature = _firstText(raw, ['temperature', 'temp', 'current_temp']);
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(gradient: LinearGradient(colors: [Colors.teal.shade900, Colors.indigo.shade900])),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Icon(Icons.cloud, color: Colors.white, size: 52),
            const SizedBox(height: 16),
            Text(condition, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w700)),
            if (temperature != null) ...[
              const SizedBox(height: 8),
              Text('$temperature°', style: const TextStyle(color: Colors.white70, fontSize: 46, fontWeight: FontWeight.w800)),
            ],
          ],
        ),
      ),
    );
  }
}

class _NoticeWidget extends StatelessWidget {
  final List<PlayerMediaItem> items;

  const _NoticeWidget({required this.items});

  @override
  Widget build(BuildContext context) {
    final text = items.isNotEmpty
        ? (items.first.description ?? items.first.name ?? 'Notice')
        : 'Notice board';
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(gradient: LinearGradient(colors: [Colors.orange.shade900, Colors.black])),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Text(
          text,
          style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}

String? _firstText(Map<String, dynamic> raw, List<String> keys) {
  for (final key in keys) {
    final value = raw[key];
    if (value != null) {
      final text = value.toString().trim();
      if (text.isNotEmpty) return text;
    }
  }
  return null;
}

double? _asDouble(dynamic value) {
  if (value == null) return null;
  if (value is num) return value.toDouble();
  return double.tryParse(value.toString());
}*/