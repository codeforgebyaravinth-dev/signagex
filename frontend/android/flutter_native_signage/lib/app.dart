// lib/app.dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'models/player_settings.dart';
import 'screens/pairing_screen.dart';
import 'screens/player_screen.dart';
/*
const _pairCodeKey = 'pair_code';
const _backendUrlKey = 'backend_url';
const _orientationModeKey = 'orientation_mode';
const _mediaModeKey = 'media_mode';

class SignagePlayerApp extends StatelessWidget {
  const SignagePlayerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'RpSignage Native',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF002FA7), brightness: Brightness.dark),
        useMaterial3: true,
        scaffoldBackgroundColor: Colors.black,
      ),
      home: const AppBootstrap(),
    );
  }
}

class AppBootstrap extends StatefulWidget {
  const AppBootstrap({super.key});

  @override
  State<AppBootstrap> createState() => _AppBootstrapState();
}

class _AppBootstrapState extends State<AppBootstrap> {
  PlayerSettings _settings = PlayerSettings.defaults();
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final backendUrl = prefs.getString(_backendUrlKey) ?? _settings.backendUrl;
    final pairCode = prefs.getString(_pairCodeKey);
    final orientationMode = prefs.getString(_orientationModeKey) ?? _settings.orientationMode;
    final mediaMode = prefs.getString(_mediaModeKey) ?? _settings.mediaMode;

    _settings = PlayerSettings(
      backendUrl: backendUrl,
      pairCode: pairCode,
      orientationMode: orientationMode,
      mediaMode: mediaMode,
    );

    await _applySystemPreferences(_settings.orientationMode);
    await WakelockPlus.enable();

    if (mounted) {
      setState(() => _ready = true);
    }
  }

  Future<void> _applySystemPreferences(String orientationMode) async {
    final orientations = switch (orientationMode) {
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

  Future<void> _persistSettings(PlayerSettings next) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_backendUrlKey, next.backendUrl);
    await prefs.setString(_orientationModeKey, next.orientationMode);
    await prefs.setString(_mediaModeKey, next.mediaMode);
    if (next.pairCode == null || next.pairCode!.isEmpty) {
      await prefs.remove(_pairCodeKey);
    } else {
      await prefs.setString(_pairCodeKey, next.pairCode!);
    }
  }

  Future<void> _handlePair(PairingResult result) async {
    final next = _settings.copyWith(
      backendUrl: result.backendUrl,
      pairCode: result.pairCode,
    );
    await _persistSettings(next);
    await _applySystemPreferences(next.orientationMode);
    if (!mounted) return;
    setState(() => _settings = next);
  }

  Future<void> _updateSettings(PlayerSettings next) async {
    await _persistSettings(next);
    await _applySystemPreferences(next.orientationMode);
    if (!mounted) return;
    setState(() => _settings = next);
  }

  Future<void> _clearPairing() async {
    final next = _settings.copyWith(pairCode: null);
    await _persistSettings(next);
    if (!mounted) return;
    setState(() => _settings = next);
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) {
      return const Scaffold(
        backgroundColor: Colors.black,
        body: Center(
          child: SizedBox(
            width: 48,
            height: 48,
            child: CircularProgressIndicator(strokeWidth: 3),
          ),
        ),
      );
    }

    if (_settings.pairCode == null || _settings.pairCode!.isEmpty) {
      return PairingScreen(
        backendUrl: _settings.backendUrl,
        initialPairCode: _settings.pairCode,
        onPair: _handlePair,
      );
    }

    return PlayerScreen(
      settings: _settings,
      onSettingsChanged: _updateSettings,
      onClearPairing: _clearPairing,
    );
  }
}*/