package com.cxcodex.bridge;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.Locale;

public final class TaskNotificationActionActivity extends Activity {
    static final String EXTRA_MODE = "mode";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_ACTIVE_TURN_ID = "activeTurnId";
    static final String MODE_REPLY = "reply";
    static final String MODE_STOP = "stop";

    private static final int VOICE_REQUEST_CODE = 7423;
    private static final int COLOR_TEXT = Color.rgb(25, 32, 44);
    private static final int COLOR_SECONDARY = Color.rgb(91, 101, 117);
    private static final int COLOR_PRIMARY = Color.rgb(30, 99, 255);
    private static final int COLOR_SURFACE = Color.rgb(247, 249, 252);
    private static final int COLOR_BORDER = Color.rgb(218, 224, 234);

    private String threadId = "";
    private String title = "";
    private String activeTurnId = "";
    private EditText manualInput;
    private TextView hint;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(242, 245, 250));
        window.setNavigationBarColor(COLOR_SURFACE);
        window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        renderIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        renderIntent(intent);
    }

    private void renderIntent(Intent intent) {
        threadId = clean(intent.getStringExtra(TaskPetOverlayService.EXTRA_THREAD_ID), 160);
        title = clean(intent.getStringExtra(EXTRA_TITLE), 90);
        activeTurnId = clean(intent.getStringExtra(EXTRA_ACTIVE_TURN_ID), 160);
        String mode = clean(intent.getStringExtra(EXTRA_MODE), 20);
        if (threadId.isEmpty()) {
            Toast.makeText(this, "会话信息不可用", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        if (MODE_STOP.equals(mode)) {
            setContentView(buildStopConfirmation());
        } else {
            setContentView(buildReplyComposer());
        }
    }

    private View buildReplyComposer() {
        LinearLayout content = createContentColumn();
        content.addView(label("回复", 24, Typeface.BOLD, COLOR_TEXT));
        TextView taskTitle = label(title.isEmpty() ? "当前任务" : title, 15, Typeface.NORMAL, COLOR_SECONDARY);
        taskTitle.setMaxLines(2);
        content.addView(taskTitle, marginTop(6));

        Button voice = actionButton("语音输入", true);
        voice.setContentDescription("语音输入回复内容");
        voice.setOnClickListener(view -> startVoiceInput());
        content.addView(voice, marginTop(18));

        LinearLayout firstRow = createButtonRow();
        Button continueButton = actionButton("继续", false);
        continueButton.setOnClickListener(view -> submitPreset(TaskNotificationPolicy.PRESET_CONTINUE));
        Button reviewButton = actionButton("审查", false);
        reviewButton.setOnClickListener(view -> submitPreset(TaskNotificationPolicy.PRESET_REVIEW));
        firstRow.addView(continueButton, rowButtonParams(true));
        firstRow.addView(reviewButton, rowButtonParams(false));
        content.addView(firstRow, marginTop(10));

        LinearLayout secondRow = createButtonRow();
        Button planButton = actionButton("计划", false);
        planButton.setOnClickListener(view -> submitPreset(TaskNotificationPolicy.PRESET_PLAN));
        Button inputButton = actionButton("输入", false);
        inputButton.setOnClickListener(view -> focusManualInput());
        secondRow.addView(planButton, rowButtonParams(true));
        secondRow.addView(inputButton, rowButtonParams(false));
        content.addView(secondRow, marginTop(8));

        manualInput = new EditText(this);
        manualInput.setTextSize(16);
        manualInput.setTextColor(COLOR_TEXT);
        manualInput.setHintTextColor(Color.rgb(135, 145, 160));
        manualInput.setHint("输入内容，确认后发送");
        manualInput.setMinHeight(dp(58));
        manualInput.setMaxLines(3);
        manualInput.setPadding(dp(14), dp(10), dp(14), dp(10));
        manualInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        manualInput.setBackground(rounded(Color.WHITE, COLOR_BORDER, 14));
        content.addView(manualInput, marginTop(14));

        Button send = actionButton("确认发送", true);
        send.setOnClickListener(view -> submitManualInput());
        content.addView(send, marginTop(10));

        hint = label("语音识别后不会自动发送，可先修改再确认。", 12, Typeface.NORMAL, COLOR_SECONDARY);
        content.addView(hint, marginTop(8));
        return wrapScrollable(content);
    }

    private View buildStopConfirmation() {
        LinearLayout content = createContentColumn();
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        TextView status = label("停止", 26, Typeface.BOLD, COLOR_TEXT);
        content.addView(status);
        TextView taskTitle = label(title.isEmpty() ? "当前任务" : title, 16, Typeface.NORMAL, COLOR_SECONDARY);
        taskTitle.setGravity(Gravity.CENTER);
        taskTitle.setMaxLines(3);
        content.addView(taskTitle, marginTop(10));

        TextView question = label("确认停止这个任务？", 18, Typeface.BOLD, COLOR_TEXT);
        question.setGravity(Gravity.CENTER);
        content.addView(question, marginTop(28));

        Button confirm = actionButton("确认停止", true);
        confirm.setOnClickListener(view -> {
            if (activeTurnId.isEmpty()) {
                Toast.makeText(this, "任务状态正在同步，请稍后重试", Toast.LENGTH_SHORT).show();
                return;
            }
            TaskPetOverlayService.requestNotificationStop(
                this,
                threadId,
                title,
                activeTurnId
            );
            Toast.makeText(this, "已请求停止", Toast.LENGTH_SHORT).show();
            finish();
        });
        content.addView(confirm, marginTop(24));

        Button cancel = actionButton("取消", false);
        cancel.setOnClickListener(view -> finish());
        content.addView(cancel, marginTop(10));
        return wrapScrollable(content);
    }

    private void submitPreset(String preset) {
        String message = TaskNotificationPolicy.presetPrompt(preset);
        if (!message.isEmpty()) submit(message);
    }

    private void submitManualInput() {
        String message = manualInput == null || manualInput.getText() == null
            ? ""
            : manualInput.getText().toString().trim();
        if (message.isEmpty()) {
            if (hint != null) hint.setText("请输入回复内容");
            focusManualInput();
            return;
        }
        submit(message);
    }

    private void submit(String message) {
        TaskPetOverlayService.submitNotificationReply(this, threadId, title, message);
        Toast.makeText(this, "已提交，正在确认", Toast.LENGTH_SHORT).show();
        finish();
    }

    private void startVoiceInput() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.SIMPLIFIED_CHINESE.toLanguageTag())
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "说出回复内容")
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try {
            startActivityForResult(intent, VOICE_REQUEST_CODE);
        } catch (ActivityNotFoundException ignored) {
            if (hint != null) hint.setText("手表未提供语音识别服务，请手动输入。");
            focusManualInput();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != VOICE_REQUEST_CODE || resultCode != RESULT_OK || data == null) return;
        ArrayList<String> results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (results == null || results.isEmpty() || manualInput == null) return;
        manualInput.setText(results.get(0));
        manualInput.setSelection(manualInput.length());
        if (hint != null) hint.setText("请确认识别内容，再发送。");
    }

    private void focusManualInput() {
        if (manualInput == null) return;
        manualInput.requestFocus();
        manualInput.postDelayed(() -> {
            InputMethodManager keyboard = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (keyboard != null) keyboard.showSoftInput(manualInput, InputMethodManager.SHOW_IMPLICIT);
        }, 100L);
    }

    private LinearLayout createContentColumn() {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(22), dp(18), dp(22), dp(22));
        content.setBackgroundColor(COLOR_SURFACE);
        return content;
    }

    private View wrapScrollable(LinearLayout content) {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(COLOR_SURFACE);
        scroll.addView(content, new ScrollView.LayoutParams(
            ScrollView.LayoutParams.MATCH_PARENT,
            ScrollView.LayoutParams.WRAP_CONTENT
        ));
        return scroll;
    }

    private LinearLayout createButtonRow() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        return row;
    }

    private LinearLayout.LayoutParams rowButtonParams(boolean first) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(54), 1f);
        if (first) params.rightMargin = dp(4);
        else params.leftMargin = dp(4);
        return params;
    }

    private Button actionButton(String text, boolean primary) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(16);
        button.setTextColor(primary ? Color.WHITE : COLOR_TEXT);
        button.setAllCaps(false);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setMinHeight(dp(54));
        button.setPadding(dp(12), 0, dp(12), 0);
        button.setBackground(rounded(primary ? COLOR_PRIMARY : Color.WHITE, primary ? COLOR_PRIMARY : COLOR_BORDER, 14));
        return button;
    }

    private TextView label(String text, float sizeSp, int style, int color) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        view.setTypeface(Typeface.DEFAULT, style);
        view.setIncludeFontPadding(false);
        return view;
    }

    private LinearLayout.LayoutParams marginTop(int dp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.topMargin = dp(dp);
        return params;
    }

    private GradientDrawable rounded(int fillColor, int strokeColor, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fillColor);
        drawable.setCornerRadius(dp(radiusDp));
        drawable.setStroke(dp(1), strokeColor);
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static String clean(String value, int maxLength) {
        String normalized = value == null ? "" : value.trim().replaceAll("[\\r\\n\\t]+", " ");
        return normalized.length() > maxLength ? normalized.substring(0, maxLength) : normalized;
    }
}
