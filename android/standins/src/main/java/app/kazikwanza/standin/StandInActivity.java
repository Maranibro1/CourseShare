package app.kazikwanza.standin;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.viewpager2.widget.ViewPager2;

/** One screen that looks, to an accessibility service, like the real app's main list. */
public class StandInActivity extends Activity {

    private static final int[] COLORS = { 0xFF1E3A8A, 0xFF7C2D12, 0xFF14532D, 0xFF581C87, 0xFF7F1D1D };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        switch (BuildConfig.LAYOUT) {
            case "pager":
                setContentView(pager());
                break;
            case "feed":
                setContentView(feed());
                break;
            default:
                setContentView(label("Game running", 0xFF3F6212, ViewGroup.LayoutParams.MATCH_PARENT));
        }
    }

    private TextView label(String text, int color, int height) {
        TextView v = new TextView(this);
        v.setText(text);
        v.setTextColor(Color.WHITE);
        v.setTextSize(28);
        v.setGravity(Gravity.CENTER);
        v.setBackgroundColor(color);
        v.setLayoutParams(new RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height));
        return v;
    }

    /** TikTok / Shorts / Reels: a vertical ViewPager2, one full-screen post per page. */
    private View pager() {
        ViewPager2 pager = new ViewPager2(this);
        pager.setOrientation(ViewPager2.ORIENTATION_VERTICAL);
        pager.setContentDescription("feed");
        pager.setAdapter(new Posts(ViewGroup.LayoutParams.MATCH_PARENT, 1000));
        return pager;
    }

    /** Instagram / Facebook / X: a vertical feed whose first row is a sideways story tray. */
    private View feed() {
        RecyclerView list = new RecyclerView(this);
        list.setContentDescription("feed");
        list.setLayoutManager(new LinearLayoutManager(this));
        list.setAdapter(new RecyclerView.Adapter<RecyclerView.ViewHolder>() {
            @Override
            public int getItemViewType(int position) {
                return position == 0 ? 1 : 0;
            }

            @Override
            public RecyclerView.ViewHolder onCreateViewHolder(ViewGroup parent, int type) {
                if (type == 1) {
                    RecyclerView stories = new RecyclerView(parent.getContext());
                    stories.setContentDescription("stories");
                    stories.setLayoutManager(new LinearLayoutManager(parent.getContext(), LinearLayoutManager.HORIZONTAL, false));
                    stories.setAdapter(new Posts(ViewGroup.LayoutParams.MATCH_PARENT, 50, 400));
                    stories.setLayoutParams(new RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 500));
                    return new RecyclerView.ViewHolder(stories) {};
                }
                return new RecyclerView.ViewHolder(label("", 0, 900)) {};
            }

            @Override
            public void onBindViewHolder(RecyclerView.ViewHolder holder, int position) {
                if (position == 0) return;
                TextView v = (TextView) holder.itemView;
                v.setText("Post " + position);
                v.setBackgroundColor(COLORS[position % COLORS.length]);
            }

            @Override
            public int getItemCount() {
                return 1000;
            }
        });
        return list;
    }

    private final class Posts extends RecyclerView.Adapter<RecyclerView.ViewHolder> {
        private final int height;
        private final int count;
        private final int width;

        Posts(int height, int count) {
            this(height, count, ViewGroup.LayoutParams.MATCH_PARENT);
        }

        Posts(int height, int count, int width) {
            this.height = height;
            this.count = count;
            this.width = width;
        }

        @Override
        public RecyclerView.ViewHolder onCreateViewHolder(ViewGroup parent, int type) {
            TextView v = label("", 0, height);
            v.setLayoutParams(new RecyclerView.LayoutParams(width, height));
            return new RecyclerView.ViewHolder(v) {};
        }

        @Override
        public void onBindViewHolder(RecyclerView.ViewHolder holder, int position) {
            TextView v = (TextView) holder.itemView;
            v.setText("Post " + position);
            v.setBackgroundColor(COLORS[position % COLORS.length]);
        }

        @Override
        public int getItemCount() {
            return count;
        }
    }
}
