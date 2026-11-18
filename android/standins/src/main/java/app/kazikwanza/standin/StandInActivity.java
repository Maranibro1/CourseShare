package app.kazikwanza.standin;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.viewpager2.widget.ViewPager2;

/**
 * One app that looks, to an accessibility service, like the real app: the
 * same kind of list, and for YouTube and Instagram the same screens (with the
 * same view names) the lock service tells apart.
 */
public class StandInActivity extends Activity {

    private static final int[] COLORS = { 0xFF1E3A8A, 0xFF7C2D12, 0xFF14532D, 0xFF581C87, 0xFF7F1D1D };

    private FrameLayout content;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        switch (BuildConfig.LAYOUT) {
            case "pager":
                setContentView(pager(View.NO_ID));
                break;
            case "feed":
                setContentView(feed());
                break;
            case "youtube":
                setContentView(withTabs(new String[] { "Home", "Shorts", "Video" }));
                showYouTube("Home");
                break;
            case "instagram":
                setContentView(withTabs(new String[] { "Feed", "Reels" }));
                showInstagram("Feed");
                break;
            default:
                setContentView(label("Game running", 0xFF3F6212, ViewGroup.LayoutParams.MATCH_PARENT));
        }
    }

    /* ───────── Apps with tabs ───────── */

    /** A content area with a row of tabs along the bottom, like YouTube's and Instagram's. */
    private View withTabs(String[] tabs) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        for (String tab : tabs) {
            TextView b = new TextView(this);
            b.setText(tab);
            b.setTextSize(18);
            b.setGravity(Gravity.CENTER);
            b.setTextColor(Color.BLACK);
            b.setPadding(0, 36, 0, 36);
            b.setOnClickListener(v -> {
                if ("youtube".equals(BuildConfig.LAYOUT)) showYouTube(tab);
                else showInstagram(tab);
            });
            bar.addView(b, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        }
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return root;
    }

    /** Swaps the screen inside the same window, the way YouTube swaps fragments. */
    private void show(View v) {
        content.removeAllViews();
        content.addView(v, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void showYouTube(String tab) {
        switch (tab) {
            case "Shorts": {
                // The full-screen Shorts player: a vertical pager inside YouTube's page container.
                FrameLayout page = new FrameLayout(this);
                page.setId(R.id.reel_player_page_container);
                page.addView(pager(View.NO_ID));
                show(page);
                break;
            }
            case "Video": {
                // A regular video: the player across the top, comments scrolling underneath.
                LinearLayout watch = new LinearLayout(this);
                watch.setOrientation(LinearLayout.VERTICAL);
                TextView player = label("Video playing", 0xFF000000, 0);
                player.setId(R.id.watch_player);
                int playerHeight = (int) (getResources().getDisplayMetrics().heightPixels * 0.3f);
                watch.addView(player, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, playerHeight));
                RecyclerView comments = list("Comment ", 300, false);
                comments.setContentDescription("comments");
                watch.addView(comments, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
                show(watch);
                break;
            }
            default:
                // The home feed: videos, with a small Shorts shelf (which uses a Shorts view name too) at the top.
                show(youtubeHome());
        }
    }

    private void showInstagram(String tab) {
        if ("Reels".equals(tab)) show(pager(R.id.clips_viewer_view_pager));
        else show(feed());
    }

    private View youtubeHome() {
        RecyclerView list = new RecyclerView(this);
        list.setContentDescription("home");
        list.setLayoutManager(new LinearLayoutManager(this));
        list.setAdapter(new RecyclerView.Adapter<RecyclerView.ViewHolder>() {
            @Override
            public int getItemViewType(int position) {
                return position == 2 ? 1 : 0;
            }

            @Override
            public RecyclerView.ViewHolder onCreateViewHolder(ViewGroup parent, int type) {
                if (type == 1) {
                    RecyclerView shelf = new RecyclerView(parent.getContext());
                    shelf.setId(R.id.reel_recycler);
                    shelf.setContentDescription("shorts shelf");
                    shelf.setLayoutManager(new LinearLayoutManager(parent.getContext(), LinearLayoutManager.HORIZONTAL, false));
                    shelf.setAdapter(new Posts(ViewGroup.LayoutParams.MATCH_PARENT, 30, 300));
                    shelf.setLayoutParams(new RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 520));
                    return new RecyclerView.ViewHolder(shelf) {};
                }
                return new RecyclerView.ViewHolder(label("", 0, 460)) {};
            }

            @Override
            public void onBindViewHolder(RecyclerView.ViewHolder holder, int position) {
                if (position == 2) return;
                TextView v = (TextView) holder.itemView;
                v.setText("Video " + position);
                v.setBackgroundColor(COLORS[position % COLORS.length]);
            }

            @Override
            public int getItemCount() {
                return 1000;
            }
        });
        return list;
    }

    /* ───────── Lists ───────── */

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
    private View pager(int id) {
        ViewPager2 pager = new ViewPager2(this);
        if (id != View.NO_ID) pager.setId(id);
        pager.setOrientation(ViewPager2.ORIENTATION_VERTICAL);
        pager.setContentDescription("feed");
        pager.setAdapter(new Posts(ViewGroup.LayoutParams.MATCH_PARENT, 1000));
        return pager;
    }

    private RecyclerView list(String prefix, int height, boolean dark) {
        RecyclerView list = new RecyclerView(this);
        list.setLayoutManager(new LinearLayoutManager(this));
        list.setAdapter(new RecyclerView.Adapter<RecyclerView.ViewHolder>() {
            @Override
            public RecyclerView.ViewHolder onCreateViewHolder(ViewGroup parent, int type) {
                return new RecyclerView.ViewHolder(label("", 0, height)) {};
            }

            @Override
            public void onBindViewHolder(RecyclerView.ViewHolder holder, int position) {
                TextView v = (TextView) holder.itemView;
                v.setText(prefix + position);
                v.setTextColor(dark ? Color.WHITE : Color.BLACK);
                v.setBackgroundColor(dark ? COLORS[position % COLORS.length] : (position % 2 == 0 ? 0xFFF4F4F5 : 0xFFFFFFFF));
            }

            @Override
            public int getItemCount() {
                return 1000;
            }
        });
        return list;
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
                    stories.setAdapter(new Posts(ViewGroup.LayoutParams.MATCH_PARENT, 50, 160));
                    stories.setLayoutParams(new RecyclerView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 180));
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
